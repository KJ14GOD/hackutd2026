// Checks Cobol.java against values from CardDemo. Run: javac -d out Cobol.java CobolTest.java && java -Dcarddemo=<legacy/carddemo> -cp out CobolTest
public class CobolTest {
  static void eq(Object a, Object b) { if (!a.toString().equals(b.toString())) throw new AssertionError(a + " != " + b); }
  public static void main(String[] x) throws Exception {
    // CardDemo ACCTDATA first record: ACCT-CURR-BAL S9(10)V99 at offset 12, shown by COBOL as 000000019400+
    String rec = new String(java.nio.file.Files.readAllLines(java.nio.file.Path.of("" + System.getProperty("carddemo") + "/app/data/ASCII/acctdata.txt")).get(0));
    eq(Cobol.display(Cobol.zoned(Cobol.field(rec, 12, 12), 2), 12, 2, true), "000000019400+");
    eq(Cobol.zoned("0000001255{", 2), "125.50");
    eq(Cobol.zoned("00000125}", 2), "-12.50");
    eq(Cobol.zoned("0000012N", 2), "-1.25");
    eq(Cobol.toZoned(new java.math.BigDecimal("-125.50"), 11, 2, true), "0000001255}");
    eq(Cobol.toZoned(new java.math.BigDecimal("0"), 11, 2, true), "0000000000{");
    eq(Cobol.toZoned(new java.math.BigDecimal("12.34"), 5, 2, true), "0123D");
    eq(Cobol.display(new java.math.BigDecimal("9999999999.99"), 12, 2, true), "999999999999+");
    eq(Cobol.display(new java.math.BigDecimal("-5"), 4, 0, true), "0005-");
    eq(Cobol.field("AB", 1, 3), "B  ");
    System.out.println("helpers ok");
  }
}
