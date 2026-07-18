#!/usr/bin/env python3
"""Run a SQL query against Snowflake (read-only, key-pair auth). Reads creds from .env.
Usage: python3 scripts/sf_query.py "SELECT ..."   (prints rows as TSV; first line = columns)
"""
import os, sys, re

def load_env(path):
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip()
            if len(v) >= 2 and v[0] == '"' and v[-1] == '"':
                v = v[1:-1]
            env[k.strip()] = v
    return env

DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env = load_env(os.path.join(DIR, ".env"))

from cryptography.hazmat.primitives import serialization
key_pem = env["SNOWFLAKE_PRIVATE_KEY"].replace("\\n", "\n").encode()
pkey = serialization.load_pem_private_key(key_pem, password=None)
pkb = pkey.private_bytes(
    encoding=serialization.Encoding.DER,
    format=serialization.PrivateFormat.PKCS8,
    encryption_algorithm=serialization.NoEncryption(),
)

import snowflake.connector
conn = snowflake.connector.connect(
    account=env["SNOWFLAKE_ACCOUNT"],
    user=env["SNOWFLAKE_USERNAME"],
    private_key=pkb,
    warehouse=env.get("SNOWFLAKE_WAREHOUSE"),
    database=env.get("SNOWFLAKE_DATABASE"),
    schema=env.get("SNOWFLAKE_SCHEMA"),
    login_timeout=30,
)
q = sys.argv[1]
cur = conn.cursor()
cur.execute(q)
cols = [c[0] for c in cur.description]
print("\t".join(cols))
for row in cur.fetchmany(int(sys.argv[2]) if len(sys.argv) > 2 else 50):
    print("\t".join("" if v is None else str(v) for v in row))
cur.close(); conn.close()
