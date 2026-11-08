      * Runs one legacy batch program the way a JCL step does: its
      * PARM arrives as a halfword length followed by the text.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. RUNDRV.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-PROGRAM        PIC X(8).
       01 WS-PARM-TEXT      PIC X(100).
       01 WS-PARMS.
          05 WS-PARM-LENGTH PIC S9(4) COMP.
          05 WS-PARM-DATA   PIC X(100).
       PROCEDURE DIVISION.
           ACCEPT WS-PROGRAM FROM ENVIRONMENT 'THESEUS_PROGRAM'.
           ACCEPT WS-PARM-TEXT FROM ENVIRONMENT 'THESEUS_PARM'.
           MOVE WS-PARM-TEXT TO WS-PARM-DATA.
           MOVE FUNCTION LENGTH(FUNCTION TRIM(WS-PARM-TEXT))
             TO WS-PARM-LENGTH.
           IF WS-PARM-TEXT = SPACES
              MOVE 0 TO WS-PARM-LENGTH
           END-IF.
           CALL WS-PROGRAM USING WS-PARMS
             ON EXCEPTION
               DISPLAY 'THESEUS-ERROR program not found: ' WS-PROGRAM
               MOVE 99 TO RETURN-CODE
           END-CALL.
           STOP RUN.
