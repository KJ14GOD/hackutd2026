# Sandbox for the Runtime witness (docs/SPEC_DEPENDENCY_PASSES.md §2): GnuCOBOL to compile and run
# legacy batch programs, PostgreSQL standing in for DB2, and Open-COBOL-ESQL to translate EXEC SQL.
# Runs with --network none; Postgres lives inside the container, so there are no credentials.
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends gnucobol libcob4-dev postgresql libpq-dev \
      build-essential autoconf automake libtool pkg-config bison flex ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://github.com/opensourcecobol/Open-COBOL-ESQL/archive/refs/tags/v1.4.tar.gz | tar xz -C /tmp \
 && cd /tmp/Open-COBOL-ESQL-1.4 && autoreconf -fi >/dev/null 2>&1 \
 && ./configure --quiet && make -s && make -s install && ldconfig \
 && mkdir -p /opt/ocesql && cp -r copy /opt/ocesql/ && rm -rf /tmp/Open-COBOL-ESQL-1.4
ENV PATH=/usr/lib/postgresql/15/bin:$PATH
RUN useradd -m runner
USER runner
WORKDIR /work
