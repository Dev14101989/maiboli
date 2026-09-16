package app.maiboli.android;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;

public class FloatService extends Service {
  private static final int SAMPLE_RATE = 16000;
  private static final int HARD_CAP_SECONDS = 3600; // absolute safety cap: 1 hour

  private WindowManager wm;
  private ImageView bubble;
  private WindowManager.LayoutParams lp;
  private final Handler main = new Handler(Looper.getMainLooper());

  private volatile boolean recording = false;
  private volatile boolean busy = false;
  private AudioRecord recorder;
  private Thread recThread;
  private ByteArrayOutputStream pcm;

  private final Runnable timeUp = this::showTimeUpPrompt;
  private final Runnable promptTimeout = this::promptExpired;
  private LinearLayout prompt;

  @Override public IBinder onBind(Intent i) { return null; }

  @Override public void onCreate() {
    super.onCreate();
    startAsForeground();
    addBubble();
  }

  private void startAsForeground() {
    NotificationManager nm = getSystemService(NotificationManager.class);
    NotificationChannel ch = new NotificationChannel("maiboli", "Maiboli", NotificationManager.IMPORTANCE_LOW);
    nm.createNotificationChannel(ch);
    Intent open = new Intent(this, MainActivity.class);
    PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE);
    Notification n = new Notification.Builder(this, "maiboli")
        .setContentTitle("Maiboli floating mic is on")
        .setContentText("Tap the bubble, speak, tap again.")
        .setSmallIcon(android.R.drawable.ic_btn_speak_now)
        .setContentIntent(pi)
        .build();
    if (Build.VERSION.SDK_INT >= 29) {
      startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
    } else {
      startForeground(1, n);
    }
  }

  private void addBubble() {
    wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
    float d = getResources().getDisplayMetrics().density;
    int size = (int) (56 * d);
    int pad = (int) (14 * d);

    bubble = new ImageView(this);
    bubble.setImageResource(R.drawable.ic_mic);
    bubble.setPadding(pad, pad, pad, pad);
    setBubbleColor(0xFF0C5A6E);

    SharedPreferences prefs = getSharedPreferences("maiboli", MODE_PRIVATE);
    lp = new WindowManager.LayoutParams(
        size, size,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
        PixelFormat.TRANSLUCENT);
    lp.gravity = Gravity.TOP | Gravity.START;
    lp.x = prefs.getInt("bx", getResources().getDisplayMetrics().widthPixels - size - (int) (10 * d));
    lp.y = prefs.getInt("by", getResources().getDisplayMetrics().heightPixels / 2);

    bubble.setOnTouchListener(new View.OnTouchListener() {
      private int startX, startY;
      private float downX, downY;
      private boolean moved;

      @Override public boolean onTouch(View v, MotionEvent e) {
        switch (e.getAction()) {
          case MotionEvent.ACTION_DOWN:
            startX = lp.x; startY = lp.y;
            downX = e.getRawX(); downY = e.getRawY();
            moved = false;
            return true;
          case MotionEvent.ACTION_MOVE:
            int dx = (int) (e.getRawX() - downX);
            int dy = (int) (e.getRawY() - downY);
            if (Math.abs(dx) > 12 || Math.abs(dy) > 12) moved = true;
            lp.x = startX + dx;
            lp.y = startY + dy;
            wm.updateViewLayout(bubble, lp);
            return true;
          case MotionEvent.ACTION_UP:
            if (moved) {
              getSharedPreferences("maiboli", MODE_PRIVATE).edit().putInt("bx", lp.x).putInt("by", lp.y).apply();
            } else {
              toggle();
            }
            return true;
        }
        return false;
      }
    });

    wm.addView(bubble, lp);
  }

  private void setBubbleColor(int color) {
    GradientDrawable g = new GradientDrawable();
    g.setShape(GradientDrawable.OVAL);
    g.setColor(color);
    g.setStroke(3, Color.WHITE);
    bubble.setBackground(g);
  }

  private void setState(String state) {
    main.post(() -> {
      if (bubble == null) return;
      switch (state) {
        case "rec":  setBubbleColor(0xFFE8413C); bubble.setImageResource(R.drawable.ic_stop); break;
        case "busy": setBubbleColor(0xFFE69B1F); bubble.setImageResource(R.drawable.ic_busy); break;
        default:      setBubbleColor(0xFF0C5A6E); bubble.setImageResource(R.drawable.ic_mic);
      }
    });
  }

  private void toggle() {
    if (busy) return;
    if (!recording) startRecording(); else stopRecording();
  }

  private int minutesSetting(String key, int def) {
    try {
      String v = getSharedPreferences("maiboli", MODE_PRIVATE).getString(key, String.valueOf(def)).trim();
      if (v.isEmpty()) return 0; // blank = no limit
      return Math.max(0, Integer.parseInt(v));
    } catch (Exception e) {
      return def;
    }
  }

  private void startRecording() {
    int minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
    try {
      recorder = new AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE,
          AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(minBuf, SAMPLE_RATE));
      recorder.startRecording();
    } catch (Exception e) {
      toast("Mic error — open Maiboli and allow the microphone.");
      return;
    }
    recording = true;
    setState("rec");
    int maxMin = minutesSetting("maxmin", 5);
    if (maxMin > 0) main.postDelayed(timeUp, maxMin * 60_000L);
    pcm = new ByteArrayOutputStream();
    recThread = new Thread(() -> {
      byte[] buf = new byte[4096];
      long maxBytes = (long) SAMPLE_RATE * 2 * HARD_CAP_SECONDS;
      while (recording && pcm.size() < maxBytes) {
        int n = recorder.read(buf, 0, buf.length);
        if (n > 0) pcm.write(buf, 0, n);
      }
      if (recording) main.post(this::stopRecording); // hit the hard cap
    });
    recThread.start();
  }

  // ---- Time-limit prompt ----

  private void showTimeUpPrompt() {
    if (!recording || prompt != null) return;
    int extMin = Math.max(1, minutesSetting("extmin", 5));
    float d = getResources().getDisplayMetrics().density;
    int pad = (int) (18 * d);

    prompt = new LinearLayout(this);
    prompt.setOrientation(LinearLayout.VERTICAL);
    prompt.setPadding(pad, pad, pad, pad);
    GradientDrawable bg = new GradientDrawable();
    bg.setColor(0xFF263238);
    bg.setCornerRadius(16 * d);
    prompt.setBackground(bg);

    TextView msg = new TextView(this);
    msg.setText("Maiboli: time is up — still recording.\nExtend " + extMin + " more minutes?");
    msg.setTextColor(Color.WHITE);
    msg.setTextSize(15);
    prompt.addView(msg);

    LinearLayout row = new LinearLayout(this);
    row.setOrientation(LinearLayout.HORIZONTAL);

    Button stop = new Button(this);
    stop.setText("Stop & transcribe");
    stop.setAllCaps(false);
    stop.setOnClickListener(v -> {
      dismissPrompt();
      stopRecording();
    });
    row.addView(stop);

    Button extend = new Button(this);
    extend.setText("Extend " + extMin + " min");
    extend.setAllCaps(false);
    extend.setOnClickListener(v -> {
      dismissPrompt();
      main.postDelayed(timeUp, extMin * 60_000L);
      toast("Extended " + extMin + " minutes.");
    });
    row.addView(extend);

    prompt.addView(row);

    WindowManager.LayoutParams plp = new WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
        PixelFormat.TRANSLUCENT);
    plp.gravity = Gravity.CENTER;
    try {
      wm.addView(prompt, plp);
    } catch (Exception e) {
      prompt = null;
      stopRecording();
      return;
    }
    // No answer in 30 seconds -> stop and transcribe (safe default).
    main.postDelayed(promptTimeout, 30_000L);
  }

  private void promptExpired() {
    dismissPrompt();
    if (recording) {
      toast("Time limit reached — transcribing.");
      stopRecording();
    }
  }

  private void dismissPrompt() {
    main.removeCallbacks(promptTimeout);
    if (prompt != null) {
      try { wm.removeView(prompt); } catch (Exception ignored) {}
      prompt = null;
    }
  }

  private void stopRecording() {
    if (!recording) return;
    recording = false;
    main.removeCallbacks(timeUp);
    dismissPrompt();
    busy = true;
    setState("busy");
    new Thread(() -> {
      try { recThread.join(1000); } catch (InterruptedException ignored) {}
      try { recorder.stop(); } catch (Exception ignored) {}
      recorder.release();
      byte[] audio = pcm.toByteArray();
      pcm = null;
      if (audio.length < 8000) {
        toast("Too short — try again.");
        done();
        return;
      }
      try {
        SharedPreferences prefs = getSharedPreferences("maiboli", MODE_PRIVATE);
        String text = GeminiClient.transcribe(Wav.fromPcm(audio, SAMPLE_RATE), prefs);
        if (text == null || text.trim().isEmpty()) {
          toast("No speech detected.");
        } else {
          deliver(text.trim());
        }
      } catch (Exception e) {
        String msg = e.getMessage() == null ? "unknown error" : e.getMessage();
        toast("Error: " + msg);
      }
      done();
    }).start();
  }

  private void deliver(String text) {
    ClipboardManager cb = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
    cb.setPrimaryClip(ClipData.newPlainText("Maiboli", text));
    boolean pasted = PasteService.pasteIntoFocusedField(text);
    if (pasted) {
      toast("Done ✓");
    } else {
      toast("Copied — long-press the text box and Paste. (Enable Accessibility for auto-paste.)");
    }
  }

  private void done() {
    busy = false;
    setState("idle");
  }

  private void toast(String msg) {
    main.post(() -> Toast.makeText(this, msg, Toast.LENGTH_LONG).show());
  }

  @Override public void onDestroy() {
    recording = false;
    main.removeCallbacks(timeUp);
    dismissPrompt();
    if (bubble != null) {
      try { wm.removeView(bubble); } catch (Exception ignored) {}
      bubble = null;
    }
    super.onDestroy();
  }
}
