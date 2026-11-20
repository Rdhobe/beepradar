import sqlite3

import pytest

from app.dedupe import DedupeIndex
from app.normalize import canonicalize_url, fingerprint


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.execute("""CREATE TABLE jobs (id INTEGER PRIMARY KEY, canonical_url TEXT, fingerprint TEXT,
                 company TEXT, title TEXT, city TEXT, location_raw TEXT)""")
    yield c
    c.close()


def insert(c, id, url, company, title, city):
    fp = fingerprint(company, title, city)
    c.execute("INSERT INTO jobs VALUES (?,?,?,?,?,?,?)",
              (id, canonicalize_url(url), fp, company, title, city, None))
    return fp


def test_url_layer(conn):
    insert(conn, 1, "https://acme.com/jobs/1?utm_source=x", "Acme", "SDE Intern", "Bengaluru")
    idx = DedupeIndex(conn)
    hit = idx.find(canonicalize_url("https://acme.com/jobs/1"), "otherfp", "Acme", "Bengaluru", "SDE Intern")
    assert hit == ("url", 1)


def test_fingerprint_layer(conn):
    fp = insert(conn, 1, "https://acme.com/jobs/1", "Acme Pvt Ltd", "Software Engineer Intern", "Bengaluru")
    idx = DedupeIndex(conn)
    hit = idx.find("https://jooble.org/redirect/999", fp, "ACME", "Bengaluru", "software engineer intern")
    assert hit == ("fingerprint", 1)


def test_fuzzy_layer(conn):
    insert(conn, 1, "https://acme.com/jobs/1", "Acme", "Software Engineer Intern", "Bengaluru")
    idx = DedupeIndex(conn)
    hit = idx.find("https://other.com/x", "newfp", "Acme", "Bengaluru", "Software Engineering Internship")
    assert hit is not None and hit[0] == "fuzzy" and hit[1] == 1


def test_fuzzy_requires_same_company(conn):
    insert(conn, 1, "https://acme.com/jobs/1", "Acme", "Software Engineer Intern", "Bengaluru")
    idx = DedupeIndex(conn)
    assert idx.find("https://other.com/x", "newfp", "Globex", "Bengaluru", "Software Engineer Intern") is None


def test_fuzzy_respects_city(conn):
    insert(conn, 1, "https://acme.com/jobs/1", "Acme", "Software Engineer Intern", "Bengaluru")
    idx = DedupeIndex(conn)
    assert idx.find("https://other.com/x", "newfp", "Acme", "Pune", "Software Engineer Intern") is None


def test_no_false_positive_different_title(conn):
    insert(conn, 1, "https://acme.com/jobs/1", "Acme", "Software Engineer Intern", "Bengaluru")
    idx = DedupeIndex(conn)
    assert idx.find("https://acme.com/jobs/2", "newfp", "Acme", "Bengaluru", "Product Marketing Manager") is None


def test_within_batch_dedupe(conn):
    idx = DedupeIndex(conn)
    fp = fingerprint("Acme", "SDE Intern", "Bengaluru")
    assert idx.find("https://a.com/1", fp, "Acme", "Bengaluru", "SDE Intern") is None
    idx.add(1, "https://a.com/1", fp, "Acme", "Bengaluru", "SDE Intern")
    assert idx.find("https://a.com/1", fp, "Acme", "Bengaluru", "SDE Intern") == ("url", 1)