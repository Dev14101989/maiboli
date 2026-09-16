package app.maiboli.android;

import android.content.SharedPreferences;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** One call to Gemini: audio in, finished text out (translate + script + optional rewrite). */
public class GeminiClient {

  static String transcribe(byte[] wav, SharedPreferences prefs) throws Exception {
    String key = prefs.getString("key", "");
    if (key.isEmpty()) throw new Exception("no API key — open Maiboli and add your Gemini key.");
    String model = prefs.getString("model", "gemini-3.5-flash");
    if (model.isEmpty()) model = "gemini-3.5-flash";

    String instruction = buildInstruction(prefs);

    JSONObject inline = new JSONObject()
        .put("mime_type", "audio/wav")
        .put("data", Base64.encodeToString(wav, Base64.NO_WRAP));
    JSONArray parts = new JSONArray()
        .put(new JSONObject().put("inline_data", inline))
        .put(new JSONObject().put("text", instruction));
    JSONObject body = new JSONObject()
        .put("contents", new JSONArray().put(new JSONObject().put("parts", parts)));

    String url = "https://generativelanguage.googleapis.com/v1beta/models/" + model
        + ":generateContent?key=" + key;

    Exception last = null;
    for (int attempt = 0; attempt < 3; attempt++) {
      try {
        String resp = post(url, body.toString());
        JSONObject json = new JSONObject(resp);
        JSONArray cands = json.optJSONArray("candidates");
        if (cands == null || cands.length() == 0) {
          JSONObject err = json.optJSONObject("error");
          throw new Exception(err != null ? err.optString("message", "empty response") : "empty response");
        }
        JSONArray outParts = cands.getJSONObject(0).getJSONObject("content").getJSONArray("parts");
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < outParts.length(); i++) {
          sb.append(outParts.getJSONObject(i).optString("text", ""));
        }
        return sb.toString();
      } catch (RetryableException e) {
        last = e;
        Thread.sleep(2000L * (attempt + 1));
      }
    }
    throw new Exception("Gemini busy (tried 3 times) — " + (last == null ? "" : last.getMessage()));
  }

  private static String buildInstruction(SharedPreferences prefs) {
    boolean hindi = "hi".equals(prefs.getString("lang", "en"));
    boolean deva = "deva".equals(prefs.getString("script", "roman"));
    boolean rewrite = prefs.getBoolean("rewrite", false);

    String target;
    if (!hindi) {
      target = "Translate the speech into natural, correct English.";
    } else if (deva) {
      target = "Write the speech in Hindi using Devanagari script. If the speaker used another language, translate it into Hindi.";
    } else {
      target = "Write the speech in Hindi using Roman (Latin) letters, the way people type Hindi in chats (Hinglish). If the speaker used another language, translate it into Hindi.";
    }

    String style = rewrite
        ? " The speaker may jump between points and repeat themselves. Reorganize the content into clear, well-ordered short sentences, merging repeated points, without losing any information."
        : " Keep it faithful to what was said — do not add, drop, or reorder content. Only clean up fillers and obvious stumbles.";

    return target + style + " Output ONLY the final text, with no explanations, no labels, and no quotes.";
  }

  private static String post(String urlStr, String jsonBody) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(urlStr).openConnection();
    c.setRequestMethod("POST");
    c.setRequestProperty("Content-Type", "application/json");
    c.setConnectTimeout(20000);
    c.setReadTimeout(60000);
    c.setDoOutput(true);
    try (OutputStream os = c.getOutputStream()) {
      os.write(jsonBody.getBytes("UTF-8"));
    }
    int code = c.getResponseCode();
    InputStream is = code >= 400 ? c.getErrorStream() : c.getInputStream();
    StringBuilder sb = new StringBuilder();
    if (is != null) {
      try (BufferedReader r = new BufferedReader(new InputStreamReader(is, "UTF-8"))) {
        String line;
        while ((line = r.readLine()) != null) sb.append(line);
      }
    }
    if (code == 429 || code >= 500) throw new RetryableException("HTTP " + code);
    if (code >= 400) {
      String msg = "HTTP " + code;
      try {
        JSONObject err = new JSONObject(sb.toString()).optJSONObject("error");
        if (err != null) msg = err.optString("message", msg);
      } catch (Exception ignored) {}
      throw new Exception(msg);
    }
    return sb.toString();
  }

  private static class RetryableException extends Exception {
    RetryableException(String m) { super(m); }
  }
}
