      * Runs one legacy DB2 batch program against the sandbox's
      * PostgreSQL: connects, calls it with its PARM, then commits,
      * the way DB2 commits when a TSO batch step ends normally.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. SQLDRV.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       EXEC SQL BEGIN DECLARE SECTION END-EXEC.
       01 DB-NAME         PIC X(30) VALUE 'carddemo'.
       01 DB-USER         PIC X(30) VALUE 'runner'.
       01 DB-PASS         PIC X(10) VALUE SPACE.
       EXEC SQL END DECLARE SECTION END-EXEC.
       EXEC SQL INCLUDE SQLCA END-EXEC.
       01 WS-PROGRAM        PIC X(8).
       01 WS-RC             PIC S9(9) BINARY VALUE 0.
       01 WS-PARM-TEXT      PIC X(100).
       01 WS-PARMS.
          05 WS-PARM-LENGTH PIC S9(4) COMP.
          05 WS-PARM-DATA   PIC X(100).
       PROCEDURE DIVISION.
           EXEC SQL
               CONNECT :DB-USER IDENTIFIED BY :DB-PASS USING :DB-NAME
           END-EXEC.
           IF SQLCODE NOT = ZERO
              DISPLAY 'THESEUS-ERROR database connect ' SQLCODE
              MOVE 99 TO RETURN-CODE
              STOP RUN
           END-IF.
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
      * The SQL calls below reset RETURN-CODE, so keep the program's.
           MOVE RETURN-CODE TO WS-RC.
           EXEC SQL COMMIT WORK END-EXEC.
           EXEC SQL DISCONNECT ALL END-EXEC.
           MOVE WS-RC TO RETURN-CODE.
           STOP RUN.
