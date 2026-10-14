#!/usr/bin/env python3
"""
Generate a hashed password and print a ready-to-run SQL INSERT for the default admin user.

Usage examples:
  python generate_admin_insert.py 'GantiDenganPasswordKuatAnda'
  ADMIN_PASSWORD='GantiDenganPasswordKuatAnda' python generate_admin_insert.py --username admin1 --email admin1@example.com

This script requires `werkzeug` (already in requirements.txt).
"""
import os
import sys
import argparse
from werkzeug.security import generate_password_hash


def main():
    parser = argparse.ArgumentParser(description='Generate admin INSERT SQL with hashed password')
    parser.add_argument('password', nargs='?', help='Plain text password (or set ADMIN_PASSWORD env var)')
    parser.add_argument('--username', default='admin', help='Admin username')
    parser.add_argument('--email', default='admin@musica-jaya.com', help='Admin email')
    parser.add_argument('--full-name', default='Admin Musica Jaya', help='Admin full name')
    parser.add_argument('--role', default='admin', help='Role value')
    args = parser.parse_args()

    pwd = args.password or os.getenv('ADMIN_PASSWORD')
    if not pwd:
        print('Error: provide password as first arg or set ADMIN_PASSWORD environment variable')
        sys.exit(2)

    pwd_hash = generate_password_hash(pwd)

    # Escape single quotes for SQL
    safe_hash = pwd_hash.replace("'", "''")
    safe_username = args.username.replace("'", "''")
    safe_email = args.email.replace("'", "''")
    safe_full = args.full_name.replace("'", "''")
    safe_role = args.role.replace("'", "''")

    sql = (
        "INSERT INTO admin_users (username, password_hash, email, full_name, role, status) VALUES "
        "('%s', '%s', '%s', '%s', '%s', 'active') "
        "ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), updated_at=NOW();"
        % (safe_username, safe_hash, safe_email, safe_full, safe_role)
    )

    print("-- COPY and run this SQL inside your `musica_jaya` database:\n")
    print(sql)


if __name__ == '__main__':
    main()
