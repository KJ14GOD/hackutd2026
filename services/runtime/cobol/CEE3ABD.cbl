      * Stub for the IBM Language Environment abend routine. It
      * records the call, then ends the run with return code 16.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. CEE3ABD.
       DATA DIVISION.
       LINKAGE SECTION.
       01 LK-ABCODE PIC S9(9) BINARY.
       01 LK-TIMING PIC S9(9) BINARY.
       PROCEDURE DIVISION USING LK-ABCODE LK-TIMING.
           DISPLAY 'THESEUS-STUB CEE3ABD'.
           MOVE 16 TO RETURN-CODE.
           STOP RUN.
