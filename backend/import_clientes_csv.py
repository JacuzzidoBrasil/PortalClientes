# import_clientes_csv.py
import csv
import os
import pymysql
from passlib.context import CryptContext

CSV_PATH = os.getenv("CSV_PATH", "/app/clientes.csv")

DB = {
    "host": os.getenv("DB_HOST", "chatbot_portal"),
    "port": int(os.getenv("DB_PORT", "3306")),
    "user": os.getenv("DB_USER", "portal_user"),
    "password": os.getenv("DB_PASS", ""),
    "database": os.getenv("DB_NAME", "portal_clientes"),
    "charset": "utf8mb4",
    "autocommit": False,
}

UF_CODES = {
    "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT",
    "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
}

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def parse_first_access(value: str) -> int:
    v = (value or "").strip().lower()
    return 1 if v in {"1", "true", "sim", "yes"} else 0


def parse_access_levels(raw: str) -> list[str]:
    # aceita "A;B;C" ou "A|B|C"
    text = (raw or "").strip()
    if not text:
        return []
    if ";" in text:
        return [x.strip() for x in text.split(";") if x.strip()]
    if "|" in text:
        return [x.strip() for x in text.split("|") if x.strip()]
    return [text]


def main():
    if not os.path.exists(CSV_PATH):
        raise FileNotFoundError(f"CSV não encontrado: {CSV_PATH}")

    conn = pymysql.connect(**DB)

    inserted = 0
    updated = 0
    links = 0

    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name FROM access_levels")
            level_map = {name: lvl_id for lvl_id, name in cur.fetchall()}

            with open(CSV_PATH, "r", encoding="utf-8-sig", newline="") as f:
                reader = csv.DictReader(f)

                for row in reader:
                    cnpj = (row.get("cnpj") or "").strip()
                    name = (row.get("name") or "").strip()
                    email = (row.get("email") or "").strip() or None
                    uf = (row.get("uf") or "").strip().upper()
                    password = (row.get("password") or "")
                    first_access_completed = parse_first_access(row.get("first_access_completed", "0"))

                    if not cnpj or not name or not password:
                        raise ValueError(f"Linha inválida (cnpj/name/password obrigatório): {row}")
                    if uf not in UF_CODES:
                        raise ValueError(f"UF inválida para {cnpj}: {uf}")
                    if uf not in level_map:
                        raise ValueError(f"Nível de acesso UF não existe em access_levels: {uf}")

                    extra_levels = parse_access_levels(row.get("access_levels", ""))
                    for lv in extra_levels:
                        if lv not in level_map:
                            raise ValueError(f"Nível não encontrado para {cnpj}: {lv}")

                    password_hash = pwd_context.hash(password)

                    cur.execute("SELECT id FROM users WHERE cnpj = %s", (cnpj,))
                    found = cur.fetchone()

                    if found:
                        user_id = found[0]
                        cur.execute(
                            """
                            UPDATE users
                               SET name=%s,
                                   email=%s,
                                   uf=%s,
                                   password_hash=%s,
                                   status='active',
                                   is_admin=0,
                                   first_access_completed=%s
                             WHERE id=%s
                            """,
                            (name, email, uf, password_hash, first_access_completed, user_id),
                        )
                        updated += 1
                    else:
                        cur.execute(
                            """
                            INSERT INTO users
                                (cnpj, name, email, uf, password_hash, status, is_admin, first_access_completed)
                            VALUES
                                (%s, %s, %s, %s, %s, 'active', 0, %s)
                            """,
                            (cnpj, name, email, uf, password_hash, first_access_completed),
                        )
                        user_id = cur.lastrowid
                        inserted += 1

                    # Sincroniza acessos: limpa e recria (UF + níveis do CSV)
                    cur.execute("DELETE FROM user_access_levels WHERE user_id = %s", (user_id,))
                    levels = {uf, *extra_levels}
                    for lv in levels:
                        cur.execute(
                            "INSERT INTO user_access_levels (user_id, access_level_id) VALUES (%s, %s)",
                            (user_id, level_map[lv]),
                        )
                        links += 1

        conn.commit()
        print(f"OK: inserted={inserted}, updated={updated}, access_links={links}")

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
