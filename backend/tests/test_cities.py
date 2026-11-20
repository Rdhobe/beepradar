from app.cities import detect_cities, guess_city, is_india_location


def test_aliases():
    assert guess_city("Bangalore") == "Bengaluru"
    assert guess_city("Bengaluru Urban, Karnataka") == "Bengaluru"
    assert guess_city("Gurgaon") == "Delhi_NCR"
    assert guess_city("Noida, Uttar Pradesh") == "Delhi_NCR"
    assert guess_city("Bombay") == "Mumbai"
    assert guess_city("Navi Mumbai") == "Mumbai"
    assert guess_city("Cochin") == "Kochi"


def test_multiple():
    assert guess_city("Bengaluru / Pune / Hyderabad") == "Multiple"


def test_other_india():
    assert guess_city("Coimbatore, Tamil Nadu") == "Other_India"
    assert guess_city("India") == "Other_India"


def test_remote():
    assert guess_city("Remote (India)") == "Remote_India"
    assert guess_city("Remote - APAC") == "Remote_India"
    assert guess_city("Remote (US only)") is None


def test_unknown_non_india():
    assert guess_city("London, UK") is None
    assert guess_city("New York, NY") is None
    assert guess_city(None) is None


def test_is_india_location():
    assert is_india_location("Pune, Maharashtra")
    assert is_india_location("India")
    assert is_india_location("Remote", "We hire across India and APAC")
    assert not is_india_location("Berlin, Germany")
    assert not is_india_location("Remote", "US citizens only")
    assert not is_india_location(None)


def test_no_substring_false_positive():
    assert "Pune" not in detect_cities("Punewala Street")  # word-boundary matching