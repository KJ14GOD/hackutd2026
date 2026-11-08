// Helpers for COBOL data in fixed-width text records. Tested; use them as they are.
final class Cobol {
  private Cobol() {}
  /** Characters [offset, offset+length) of a record, padding a short line with spaces. */
  static String field(String rec, int offset, int length) {
    StringBuilder s = new StringBuilder(length);
    for (int i = offset; i < offset + length; i++) s.append(i < rec.length() ? rec.charAt(i) : ' ');
    return s.toString();
  }
  /** Value of a zoned-decimal field (PIC S9(n)V9(scale) or 9(n)), sign overpunched in the last character. */
  static java.math.BigDecimal zoned(String text, int scale) {
    StringBuilder digits = new StringBuilder();
    boolean negative = false;
    for (int i = 0; i < text.length(); i++) {
      char c = text.charAt(i);
      if (i == text.length() - 1) {
        if (c == '{') { digits.append('0'); continue; }
        if (c == '}') { digits.append('0'); negative = true; continue; }
        if (c >= 'A' && c <= 'I') { digits.append((char) ('1' + (c - 'A'))); continue; }
        if (c >= 'J' && c <= 'R') { digits.append((char) ('1' + (c - 'J'))); negative = true; continue; }
      }
      digits.append(c >= '0' && c <= '9' ? c : '0');
    }
    java.math.BigDecimal v = new java.math.BigDecimal(new java.math.BigInteger(digits.length() == 0 ? "0" : digits.toString()), scale);
    return negative ? v.negate() : v;
  }
  /** The field as a record stores it: digits, last one overpunched with the sign when signed. Truncates high digits like COBOL. */
  static String toZoned(java.math.BigDecimal value, int digits, int scale, boolean signed) {
    java.math.BigInteger unscaled = value.setScale(scale, java.math.RoundingMode.DOWN).unscaledValue();
    boolean negative = unscaled.signum() < 0;
    String s = unscaled.abs().toString();
    if (s.length() > digits) s = s.substring(s.length() - digits);
    s = "0".repeat(digits - s.length()) + s;
    if (!signed) return s;
    int last = s.charAt(digits - 1) - '0';
    char mark = negative ? (last == 0 ? '}' : (char) ('J' + last - 1)) : (last == 0 ? '{' : (char) ('A' + last - 1));
    return s.substring(0, digits - 1) + mark;
  }
  /** What DISPLAY prints for a numeric DISPLAY item: all digits, then a trailing + or - when the PIC is signed. */
  static String display(java.math.BigDecimal value, int digits, int scale, boolean signed) {
    java.math.BigInteger unscaled = value.setScale(scale, java.math.RoundingMode.DOWN).unscaledValue();
    String s = unscaled.abs().toString();
    if (s.length() > digits) s = s.substring(s.length() - digits);
    s = "0".repeat(digits - s.length()) + s;
    return signed ? s + (unscaled.signum() < 0 ? "-" : "+") : s;
  }
}
