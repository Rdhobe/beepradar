from app.normalize import (
    canonicalize_url, clean_description, fingerprint, norm_company, norm_title,
    parse_date, strip_html, strip_pii,
)


def test_strip_html():
    assert strip_html("<p>Hello <b>world</b></p><br/>Next") == "Hello world Next"
    assert strip_html("plain text") == "plain text"
    assert strip_html(None) == ""


def test_canonicalize_url_strips_tracking():
    url = "https://www.Example.com/jobs/123/?utm_source=x&utm_medium=y&id=5&gclid=abc#frag"
    assert canonicalize_url(url) == "https://example.com/jobs/123?id=5"


def test_canonicalize_url_trailing_slash():
    assert canonicalize_url("https://example.com/jobs/") == "https://example.com/jobs"
    assert canonicalize_url("https://example.com") == "https://example.com/"


def test_norm_company_legal_suffixes():
    assert norm_company("Razorpay Software Pvt Ltd") == norm_company("Razorpay")
    assert norm_company("Acme Technologies, Inc.") == norm_company("ACME")


def test_norm_title():
    assert norm_title("SDE Intern – Software!") == "sde intern software"


def test_fingerprint_stable():
    a = fingerprint("Acme Pvt Ltd", "Software Engineer Intern", "Bengaluru")
    b = fingerprint("ACME", "software engineer intern", "Bengaluru")
    assert a == b
    assert a != fingerprint("Acme", "Software Engineer Intern", "Pune")


def test_parse_date_formats():
    assert parse_date("2026-11-01T10:00:00Z") == "2026-11-01T10:00:00Z"
    assert parse_date("2026-11-01") == "2026-11-01T00:00:00Z"
    assert parse_date("Mon, 02 Nov 2026 10:00:00 GMT") == "2026-11-02T10:00:00Z"
    assert parse_date("1762000000") is not None
    assert parse_date("not a date") is None
    assert parse_date(None) is None


def test_strip_pii():
    text = "Mail hr@acme.com or call +91 9876543210 / 9876543210"
    out = strip_pii(text)
    assert "hr@acme.com" not in out
    assert "9876543210" not in out


def test_clean_description_truncates():
    assert len(clean_description("x" * 9000)) == 4000