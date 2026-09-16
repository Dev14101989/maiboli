package app.maiboli.android;

import android.accessibilityservice.AccessibilityService;
import android.os.Bundle;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

public class PasteService extends AccessibilityService {
  private static volatile PasteService instance;

  @Override protected void onServiceConnected() {
    super.onServiceConnected();
    instance = this;
  }

  @Override public void onDestroy() {
    instance = null;
    super.onDestroy();
  }

  @Override public void onAccessibilityEvent(AccessibilityEvent event) { }

  @Override public void onInterrupt() { }

  /** Paste text into whatever text box currently has the cursor. Returns true on success. */
  static boolean pasteIntoFocusedField(String text) {
    PasteService s = instance;
    if (s == null) return false;
    try {
      AccessibilityNodeInfo node = s.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
      if (node == null || !node.isEditable()) return false;
      // Clipboard already holds the text (set by FloatService); paste keeps cursor position.
      if (node.performAction(AccessibilityNodeInfo.ACTION_PASTE)) return true;
      // Fallback: replace field content with old + new text.
      CharSequence old = node.getText();
      String combined = (old == null ? "" : old.toString()) + text;
      Bundle args = new Bundle();
      args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, combined);
      return node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
    } catch (Exception e) {
      return false;
    }
  }
}
