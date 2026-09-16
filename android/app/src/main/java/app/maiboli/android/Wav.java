package app.maiboli.android;

import java.io.ByteArrayOutputStream;
import java.io.IOException;

/** Builds a WAV file (16-bit mono PCM) from raw audio bytes. */
public class Wav {
  static byte[] fromPcm(byte[] pcm, int sampleRate) {
    try {
      ByteArrayOutputStream out = new ByteArrayOutputStream(pcm.length + 44);
      int byteRate = sampleRate * 2;
      out.write("RIFF".getBytes());
      out.write(intLE(36 + pcm.length));
      out.write("WAVE".getBytes());
      out.write("fmt ".getBytes());
      out.write(intLE(16));
      out.write(shortLE(1));            // PCM
      out.write(shortLE(1));            // mono
      out.write(intLE(sampleRate));
      out.write(intLE(byteRate));
      out.write(shortLE(2));            // block align
      out.write(shortLE(16));           // bits per sample
      out.write("data".getBytes());
      out.write(intLE(pcm.length));
      out.write(pcm);
      return out.toByteArray();
    } catch (IOException e) {
      throw new RuntimeException(e);
    }
  }

  private static byte[] intLE(int v) {
    return new byte[]{(byte) v, (byte) (v >> 8), (byte) (v >> 16), (byte) (v >> 24)};
  }

  private static byte[] shortLE(int v) {
    return new byte[]{(byte) v, (byte) (v >> 8)};
  }
}
