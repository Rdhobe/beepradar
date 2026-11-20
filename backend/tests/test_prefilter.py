from app.models import RawJob
from app.prefilter import fresher_heuristic, is_blocked_url, prefilter


def job(**kw):
    base = dict(source="test", url="https://acme.com/jobs/1", title="Software Engineer Intern",
                company="Acme", location_raw="Bengaluru, India")
    base.update(kw)
    return RawJob(**base)


def test_blocklist():
    assert is_blocked_url("https://www.linkedin.com/jobs/view/123", ["linkedin.com"])
    assert is_blocked_url("https://in.indeed.com/viewjob?jk=1", ["indeed.com"])
    assert not is_blocked_url("https://boards.greenhouse.io/acme/jobs/1", ["linkedin.com"])


def test_fresher_positive():
    assert fresher_heuristic(job(title="SDE Intern"))
    assert fresher_heuristic(job(title="Graduate Trainee"))
    assert fresher_heuristic(job(title="Analyst", description="Open to freshers with 0-1 years of experience"))


def test_fresher_negative():
    assert not fresher_heuristic(job(title="Senior Software Engineer"))
    assert not fresher_heuristic(job(title="Engineering Manager"))
    assert not fresher_heuristic(job(title="Staff Engineer", description="intern friendly culture"))
    assert not fresher_heuristic(job(title="Software Engineer", description="Requires 5+ years of experience"))


def test_prefilter_india_fresher():
    india, fresher, reason = prefilter(job())
    assert india and fresher and reason is None


def test_prefilter_rejects_non_india():
    _, _, reason = prefilter(job(location_raw="London, UK"))
    assert reason == "not_india"


def test_prefilter_rejects_senior():
    _, _, reason = prefilter(job(title="Senior Analyst"))
    assert reason == "not_fresher"


def test_prefilter_rejects_scam():
    _, _, reason = prefilter(job(description="Pay a registration fee of Rs 500 to apply"))
    assert reason == "scam_signal"


def test_prefilter_rejects_blocklisted():
    _, _, reason = prefilter(job(url="https://naukri.com/job/1"))
    assert reason == "blocklisted_url"