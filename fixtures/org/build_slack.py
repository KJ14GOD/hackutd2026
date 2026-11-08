"""Builds slack.json: Harbor Card's Slack history, 2019-2025. Planted facts from answer-key.md are buried in
ordinary chatter. Each conversation is a top-level message plus thread replies. Run: python3 build_slack.py"""
import json, random

random.seed(2026)

# Planted conversations (see answer-key.md). Kept word-for-word stable so tests and the key agree.
PLANTED = {
  'card-batch': [
    [('dana', '2021-02-03', 'DEFAULT disclosure group is a temporary hack until finance sends real rates for every group. will remove next year')],
    [('dev', '2022-08-30', 'heads up, I left a DISPLAY of the balance record in INTCALC (CBACT04C) while chasing INC-2207'),
     ('dev', '2022-08-30', 'SYSOUT gets purged nightly so it is harmless, safe to remove whenever'),
     ('leo', '2022-08-31', 'ok, ping me if INC-2207 comes back')],
    [('D. Okafor', '2023-02-07', 'pushed a comment typo fix on INTCALC')],
    [('dana', '2023-11-14', 'reminder the TRANID suffix in INTCALC is only 6 digits. fine for now')],
    [('maria', '2024-03-15', "Dana's last day today. Dev is taking INTCALC and POSTTRAN."),
     ('dev', '2024-03-15', 'will miss you Dana. I have the handover doc'),
     ('priya', '2024-03-15', 'thank you Dana!!')],
    [('tom', '2024-07-22', 'I think Dana said the DEFAULT disclosure group was temporary? is that still a thing'),
     ('leo', '2024-07-22', 'no, it is permanent now. see the disclosure group runbook, the load job checks it exists')],
  ],
  'mainframe-ops': [
    [('leo', '2022-02-08', 'wrote up the DISCGRP runbook. DEFAULT group is permanent, INTCALC abends if it is missing and that is on purpose')],
    [('leo', '2024-01-09', 'POSTTRAN abended again, duplicate tran id from the network feed. INTCALC will be late.'),
     ('dev', '2024-01-09', 'we keep that abend. without it we would double post'),
     ('leo', '2024-01-10', 'upstream says they dedupe now')],
    [('leo', '2025-02-03', 'VPN is down, mainframe jobs unaffected')],
  ],
  'online-dev': [
    [('tom', '2020-03-09', 'COTRN02 now picks the next transaction id as max+1. there is a race if two people add at once but volume is tiny, accepting it')],
    [('tom', '2024-11-04', 'CARD-130 is that race. we need a real sequence now'),
     ('priya', '2024-11-04', 'how soon? branches are complaining'),
     ('tom', '2024-11-05', 'after the modernization decision, no point patching COTRN02 twice')],
  ],
  'card-services': [
    [('priya', '2024-06-18', 'why does INTCALC truncate interest? filed CARD-88 to round normally'),
     ('maria', '2024-06-18', "please don't touch that before reading the interest policy page")],
  ],
  'finance-questions': [
    [('ana', '2021-08-16', 'reminder for everyone asking: late and over-limit fees are assessed by Billing, not the mainframe interest job')],
    [('ana', '2024-11-20', 'audit sample found account balances printed in a batch job SYSOUT. who owns INTCALC these days?'),
     ('maria', '2024-11-20', 'Dev, since March'),
     ('ana', '2024-11-21', 'filed CARD-131, PCI says it has to go')],
  ],
}

# Everyday chatter. Program names show up here too, so lookups have to rank, not just match.
NOISE = {
  'general': [
    ('maria', 'welcome to the new Card Services folks!'), ('sam', 'office wifi password rotates monday, check your email'),
    ('nina', 'all hands thursday 10am, agenda in the calendar invite'), ('ravi', 'great quarter everyone, thank you'),
    ('jordan', 'whoever left lunch in the fridge since friday, please'), ('priya', 'payments roadmap review moved to next week'),
    ('sam', 'laptop refresh signups are open'), ('alex', 'hi all, Alex from the Theseus modernization team. happy to answer questions'),
    ('ravi', 'reminder the holiday freeze starts dec 15. no mainframe changes after that'), ('nina', 'platform town hall recording is up'),
    ('grace', 'DB2 maintenance window this saturday 2-4am'), ('leo', 'pager rotation for next month is posted'),
  ],
  'random': [
    ('jordan', 'new printer forms arrive friday'), ('sam', 'reminder: rotate your passwords'), ('tom', 'anyone want to split a pizza order'),
    ('dev', 'my cat walked on the keyboard during the INTCALC review, sorry for the extra comment'), ('priya', 'coffee machine on 3 is fixed'),
    ('leo', 'who has the good HDMI adapter'), ('grace', 'bake sale for the food bank tomorrow'), ('ana', 'running club meets at 6'),
    ('jordan', 'parking garage closed monday'), ('maria', 'team lunch friday, Card Services is paying'), ('dana', 'farewell cake in the kitchen!'),
  ],
  'card-batch': [
    ('dev', 'INTCALC ran clean last night'), ('dana', 'POSTTRAN took 40 min, a bit slower than usual, watching it'),
    ('dev', 'reviewed the TRANREPT change, looks fine'), ('dana', 'anyone know why CBACT01C writes three output files? inherited it like that'),
    ('dev', 'month-end volume is up 20%, all jobs still in the window'), ('maria', 'can someone summarize batch health for the ops review'),
    ('dev', 'TCATBALF is getting big, might need a reorg next quarter'), ('dana', 'TRANREPT page totals look off again on the 3rd, will check'),
    ('dev', 'is anyone else seeing COBDATFT return odd dates in the test lpar'), ('leo', 'test lpar is getting a new compiler next week, heads up'),
    ('dev', 'CBTRN02C reject file had 43 records today, normal range'), ('dana', 'added comments to the posting reject codes, 100-103'),
    ('priya', 'quick q, does interest get calculated on the posting date or the run date'), ('dev', 'run date, from the job parm'),
  ],
  'mainframe-ops': [
    ('leo', 'nightly chain green'), ('leo', 'INTCALC started 20 min late because POSTTRAN overran'), ('grace', 'DB2 backups done'),
    ('leo', 'CA7 schedule updated for daylight saving'), ('nina', 'can we get a list of every job that touches ACCTDATA'),
    ('leo', 'TRANREPT printed twice, printer queue glitch, not the job'), ('sam', 'storage alert on the batch volume, cleared'),
    ('leo', 'month-end close all green'), ('grace', 'reorged ACCTDATA, should be a bit faster'), ('leo', 'restarted POSTTRAN after a file lock, no data issue'),
    ('nina', 'reminder: incidents go in #incidents, this channel is for ops chatter'),
  ],
  'online-dev': [
    ('tom', 'COACTUPC screen is 4k lines, please do not touch without telling me'), ('tom', 'new BMS map for the transaction list is in test'),
    ('priya', "can the add-transaction screen default today's date"), ('tom', 'CICS region restarted, all screens back'),
    ('tom', 'COSGN00C login screen got the new banner text'), ('dev', 'is COTRN02C still reading the xref by card number'), ('tom', 'yes, alternate key'),
    ('tom', 'user admin screens are a mess but they work'), ('priya', 'dark mode request is CARD-150 for whenever'),
  ],
  'card-services': [
    ('maria', 'quarterly policy review on the 12th'), ('priya', 'customers asked about statement dates again'), ('ravi', 'board wants the modernization plan by Q3'),
    ('maria', 'interest policy page is the source of truth, link it in tickets please'), ('priya', 'branch rollout went well'),
    ('maria', 'who is covering approvals while I am out next week? Ravi'), ('priya', 'can we get a dashboard for rejected transactions'),
  ],
  'incidents': [
    ('leo', 'INC-2207: interest category balances mismatched in the GL feed, investigating'), ('leo', 'INC-2207 resolved, data fix applied'),
    ('leo', 'INC-2311: CICS region slow, resolved by restart'), ('grace', 'INC-2402: DB2 lock contention on TRANSACTION_TYPE during maintenance, resolved'),
    ('leo', 'INC-2410: TRANREPT late, printer vendor issue'), ('sam', 'INC-2501: VPN outage 40 min, no batch impact'),
    ('leo', 'INC-2503: statement job CBSTM03A failed on bad customer record, rerun ok'),
  ],
  'deploys': [
    ('dev', 'promoted INTCALC to prod, comment change only'), ('tom', 'promoted COTRN02 date trim to prod'), ('grace', 'COBTUPDT promoted, sqlcode handling'),
    ('dana', 'promoted POSTTRAN reject codes'), ('jordan', 'TRANREPT form length change promoted'), ('leo', 'JCL change for INTCALC ordering promoted'),
    ('dev', "rolled back yesterday's TRANREPT change, totals looked wrong in UAT"), ('tom', 'COACTUPC hotfix promoted'),
  ],
  'finance-questions': [
    ('priya', 'where do I find the monthly interest totals'), ('ana', 'GL feed, not the transaction report'), ('ravi', 'can finance confirm Q2 fee revenue'),
    ('ana', 'SOX evidence for batch changes due friday'), ('priya', 'is the interest rate table owned by finance or card services'), ('ana', 'card services owns rates, finance audits them'),
  ],
  'data-platform': [
    ('grace', 'TRANSACTION_TYPE has 7 rows in prod, do not hand edit without a ticket'), ('grace', 'DB2 upgrade planned for next quarter'),
    ('nina', 'data retention policy review next month'), ('grace', 'ACCT-EXPIRAION-DATE typo is in the copybook forever, sorry'),
    ('grace', 'new read-only DB2 user for reporting'), ('leo', 'can we get the transaction type maintenance file under version control'),
  ],
}

START, END = (2019, 1), (2025, 9)

def random_date():
    y = random.randint(START[0], END[0])
    m = random.randint(1, 12 if y < END[0] else END[1])
    return f'{y}-{m:02d}-{random.randint(1, 28):02d}'

def build():
    channels = {}
    for name in sorted(set(PLANTED) | set(NOISE)):
        convos = [list(c) for c in PLANTED.get(name, [])]
        for user, text in NOISE.get(name, []):
            convos.append([(user, random_date(), text)])
        # Some noise gets a short reply, like real chatter.
        for c in convos:
            if len(c) == 1 and random.random() < 0.25 and c not in PLANTED.get(name, []):
                c.append((random.choice(['dev', 'leo', 'tom', 'priya', 'maria', 'grace']), c[0][1], random.choice(['+1', 'thanks!', 'nice', 'on it', 'ack', 'good to know'])))
        convos.sort(key=lambda c: c[0][1])
        out = []
        for c in convos:
            parent = len(out)
            out.append({'user': c[0][0], 'date': c[0][1], 'text': c[0][2]})
            for user, date, text in c[1:]:
                out.append({'user': user, 'date': date, 'text': text, 'thread': parent})
        channels[name] = out
    return channels

channels = build()
json.dump({'_source': 'Slack workspace history (synthetic), built by build_slack.py. Seeded under per-person display names; '
           'the original date is shown in the text and kept in message metadata.', 'channels': channels},
          open('slack.json', 'w'), indent=2)
print(len(channels), 'channels,', sum(len(v) for v in channels.values()), 'messages')
