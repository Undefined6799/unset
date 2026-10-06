#!/bin/sh
# PF-1 for P1.16's single_use_expires_at index: sweep's DELETE timed by EXPLAIN ANALYZE, inside a rolled-back
# transaction so every run sees the same table, 200 runs without the index and 200 with it.
set -eu
SPAN_H=${SPAN_H:-48}; SPAN_TOTAL_H=$((SPAN_H + 1))
IMAGE=postgres@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722
NAME=pf1-single-use
docker rm -f $NAME >/dev/null 2>&1 || true
docker run -d --name $NAME -e POSTGRES_PASSWORD=pf1 $IMAGE >/dev/null
until docker exec $NAME pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 2
q() { docker exec -i $NAME psql -U postgres -qAtX "$@"; }
q <<SQL
CREATE TABLE single_use (id bytea PRIMARY KEY, purpose text NOT NULL, bind_did text, bind_extra bytea,
  expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
-- 200,000 rows: expiries spread evenly over the last 48 hours and the next hour, so about half are past the
-- one-day sweep line, as when the retention job has missed a day.
INSERT INTO single_use (id, purpose, expires_at)
  SELECT sha256(int4send(g)), 'login.nonce', now() - interval '${SPAN_H} hours' + (g * interval '${SPAN_TOTAL_H} hours') / 200000
  FROM generate_series(1, 200000) g;
VACUUM ANALYZE single_use;
SQL
measure() {
  for i in $(seq 1 200); do
    q -c "BEGIN" -c "EXPLAIN (ANALYZE, FORMAT JSON) DELETE FROM single_use WHERE expires_at < now() - interval '1 day'" -c "ROLLBACK" \
      | grep -o '"Execution Time": [0-9.]*' | grep -o '[0-9.]*$'
  done | sort -n | awk '{a[NR]=$1} END {printf "p50 %.2f ms, p95 %.2f ms, p99 %.2f ms (n=%d)\n", a[int(NR*0.5)], a[int(NR*0.95)], a[int(NR*0.99)], NR}'
}
echo "rows: $(q -c 'SELECT count(*) FROM single_use'), past the line: $(q -c "SELECT count(*) FROM single_use WHERE expires_at < now() - interval '1 day'")"
echo "without index: $(measure)"
q -c "CREATE INDEX single_use_expires_at ON single_use (expires_at)" -c "ANALYZE single_use"
echo "with index:    $(measure)"
docker rm -f $NAME >/dev/null
