package app.maiboli.android;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {
  private SharedPreferences prefs;
  private EditText keyEdit, modelEdit;
  private CheckBox rewriteBox;
  private RadioButton langEn, langHi, scriptRoman, scriptDeva;

  @Override protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    prefs = getSharedPreferences("maiboli", MODE_PRIVATE);
    float d = getResources().getDisplayMetrics().density;
    int pad = (int) (16 * d);

    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setPadding(pad, pad, pad, pad);

    root.addView(heading("Maiboli — speak your language"));

    root.addView(label("Gemini API key"));
    keyEdit = new EditText(this);
    keyEdit.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
    keyEdit.setHint("paste your key from aistudio.google.com");
    keyEdit.setText(prefs.getString("key", ""));
    root.addView(keyEdit);

    root.addView(label("Model"));
    modelEdit = new EditText(this);
    modelEdit.setText(prefs.getString("model", "gemini-3.5-flash"));
    root.addView(modelEdit);

    root.addView(label("Output language"));
    RadioGroup langGroup = new RadioGroup(this);
    langGroup.setOrientation(RadioGroup.HORIZONTAL);
    langEn = makeRadio("English");
    langHi = makeRadio("Hindi");
    langGroup.addView(langEn);
    langGroup.addView(langHi);
    root.addView(langGroup);

    root.addView(label("Hindi script (only when output is Hindi)"));
    RadioGroup scriptGroup = new RadioGroup(this);
    scriptGroup.setOrientation(RadioGroup.HORIZONTAL);
    scriptRoman = makeRadio("Hinglish (ABC)");
    scriptDeva = makeRadio("Devanagari (अ)");
    scriptGroup.addView(scriptRoman);
    scriptGroup.addView(scriptDeva);
    root.addView(scriptGroup);

    rewriteBox = new CheckBox(this);
    rewriteBox.setText("AI rewrite — organize my points into clean order");
    rewriteBox.setChecked(prefs.getBoolean("rewrite", false));
    root.addView(rewriteBox);

    if ("hi".equals(prefs.getString("lang", "en"))) langHi.setChecked(true); else langEn.setChecked(true);
    if ("deva".equals(prefs.getString("script", "roman"))) scriptDeva.setChecked(true); else scriptRoman.setChecked(true);

    root.addView(makeButton("Save settings", v -> {
      save();
      Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show();
    }));

    root.addView(heading("One-time permissions"));
    root.addView(makeButton("1. Allow microphone", v -> {
      if (Build.VERSION.SDK_INT >= 33) {
        requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO, android.Manifest.permission.POST_NOTIFICATIONS}, 1);
      } else {
        requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO}, 1);
      }
    }));
    root.addView(makeButton("2. Allow floating button (display over other apps)", v ->
        startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName())))));
    root.addView(makeButton("3. Enable paste (Accessibility > Maiboli > On)", v ->
        startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))));

    root.addView(heading("Floating mic"));
    root.addView(makeButton("Start floating mic", v -> {
      save();
      if (!Settings.canDrawOverlays(this)) {
        Toast.makeText(this, "First allow the floating button (step 2)", Toast.LENGTH_LONG).show();
        return;
      }
      if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
        Toast.makeText(this, "First allow the microphone (step 1)", Toast.LENGTH_LONG).show();
        return;
      }
      startForegroundService(new Intent(this, FloatService.class));
      Toast.makeText(this, "Floating mic started — tap it, speak, tap again", Toast.LENGTH_LONG).show();
    }));
    root.addView(makeButton("Stop floating mic", v -> stopService(new Intent(this, FloatService.class))));

    TextView help = new TextView(this);
    help.setPadding(0, pad, 0, 0);
    help.setText("How to use: put your cursor in any text box (WhatsApp, notes, anywhere), tap the floating mic, speak, tap again. Your text appears there. If pasting is off, the text is on your clipboard — long-press and Paste.");
    root.addView(help);

    ScrollView sv = new ScrollView(this);
    sv.addView(root);
    setContentView(sv);
  }

  private void save() {
    prefs.edit()
        .putString("key", keyEdit.getText().toString().trim())
        .putString("model", modelEdit.getText().toString().trim())
        .putBoolean("rewrite", rewriteBox.isChecked())
        .putString("lang", langHi.isChecked() ? "hi" : "en")
        .putString("script", scriptDeva.isChecked() ? "deva" : "roman")
        .apply();
  }

  private TextView heading(String t) {
    TextView tv = new TextView(this);
    tv.setText(t);
    tv.setTextSize(18);
    tv.setPadding(0, (int) (14 * getResources().getDisplayMetrics().density), 0, 4);
    tv.setTypeface(null, android.graphics.Typeface.BOLD);
    return tv;
  }

  private TextView label(String t) {
    TextView tv = new TextView(this);
    tv.setText(t);
    tv.setPadding(0, 10, 0, 0);
    return tv;
  }

  private RadioButton makeRadio(String t) {
    RadioButton r = new RadioButton(this);
    r.setText(t);
    return r;
  }

  private Button makeButton(String t, View.OnClickListener l) {
    Button b = new Button(this);
    b.setText(t);
    b.setAllCaps(false);
    b.setOnClickListener(l);
    return b;
  }
}
