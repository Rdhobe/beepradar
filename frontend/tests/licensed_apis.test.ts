import { afterEach, describe, expect, it } from "vitest";
import { getAdapter } from "@/lib/sources";
import {
  ApifyActorAdapter,
  CleanJobDataAdapter,
  FantasticJobsAdapter,
  HirebaseAdapter,
  JobspipeAdapter,
  LinkedInJobsAdapter,
  SerpApiAdapter,
  mapApifyItem,
  mapCleanJobDataItem,
  mapFantasticJobsJob,
  mapHirebaseJob,
  mapJobspipeJob,
  mapLinkedInJob,
  mapSerpJob,
  fantasticJobsSelection,
} from "@/lib/sources/licensed_apis";
import { prefilter } from "@/lib/prefilter";
import type { SourceConfig } from "@/lib/registry";

const envBackup: Record<string, string | undefined> = {};
function setEnv(name: string, value: string) {
  if (!(name in envBackup)) envBackup[name] = process.env[name];
  process.env[name] = value;
}
afterEach(() => {
  for (const [name, value] of Object.entries(envBackup)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  for (const name of Object.keys(envBackup)) delete envBackup[name];
});

function source(id: string, api: Record<string, unknown> = {}): SourceConfig {
  return {
    id, name: id, group: "G1_monthly_hard_cap", priority: 1, enabled: true, status: "active",
    api: { base_url: "https://example.invalid", method: "GET", auth: { type: "none", env: [] }, ...api },
    limits: { level: "self_imposed", quotas: [{ n: 1, per: "day" }] },
    schedule: { cron: "0 0 * * *", max_requests_per_run: 1 },
  };
}

function response(data: unknown) {
  return { ok: true, status: 200, async json() { return data; } } as any;
}

function fakeClient(handler: (method: string, url: string, opts: any) => any) {
  return {
    async request(method: string, url: string, opts: any = {}) { return handler(method, url, opts); },
    async get(url: string, opts: any = {}) { return handler("GET", url, opts); },
    async post(url: string, opts: any = {}) { return handler("POST", url, opts); },
    async getJson(url: string, opts: any = {}) { return (await handler("GET", url, opts)).json(); },
  } as any;
}

describe("licensed feed mappers", () => {
  it("maps SerpApi Google Jobs, preferring a non-blocklisted apply link", () => {
    const mapped = mapSerpJob({
      title: "SDE Intern", company_name: "Acme", location: "Bengaluru, India",
      description: "Intern role", job_id: "gj-1",
      apply_options: [{ link: "https://in.linkedin.com/jobs/view/123" }],
      share_link: "https://www.google.com/search?q=gj-1",
      detected_extensions: { posted_at: "2 days ago" },
    }, "serpapi_google_jobs");
    expect(mapped?.url).toBe("https://www.google.com/search?q=gj-1");
    expect(mapped?.sourceId).toBe("gj-1");
    expect(mapped?.postedAt).toBe("2 days ago");
    expect(mapped?.licensedFeed).toBe(true);
  });

  it("uses a direct apply option when it is not blocklisted and derives days_since_posted", () => {
    const now = new Date("2026-11-20T12:00:00.000Z");
    const mapped = mapSerpJob({
      title: "Graduate Engineer", company_name: "Globex", location: "India",
      link: "https://www.indeed.com/viewjob?jk=abc",
      apply_options: [{ link: "https://careers.globex.in/jobs/1" }],
      days_since_posted: 3,
    }, "serpapi_indeed_jobs", now);
    expect(mapped?.url).toBe("https://careers.globex.in/jobs/1");
    expect(mapped?.postedAt).toBe("2026-11-17T12:00:00.000Z");
  });

  it("maps HireBase, LinkedIn, JobsPipe and Apify rows", () => {
    expect(mapHirebaseJob({
      id: "hb1", title: "Intern", company: { name: "Acme" }, location: { city: "Pune", country: "India" },
      description: "Internship", url: "https://acme.in/jobs/1", posted_at: "2026-11-01",
    }, "rapidapi_hirebase")).toMatchObject({
      source: "rapidapi_hirebase", title: "Intern", company: "Acme",
      locationRaw: "Pune", url: "https://acme.in/jobs/1",
    });

    expect(mapLinkedInJob({
      linkedin_id: "42", title: "Fresher Analyst", organization: "Acme", location: "Mumbai, India",
      description: "Graduate role", job_url: "https://www.linkedin.com/jobs/view/42", posted_at: "2026-11-02",
    }, "rapidapi_linkedin_jobs")).toMatchObject({
      sourceId: "42", company: "Acme", licensedFeed: true,
    });

    expect(mapJobspipeJob({
      id: "jp1", job_title: "Software Intern", company: "Acme", location: "Bengaluru",
      country: "India", url: "https://jobs.acme.in/1", description: "Intern", posted_at: "2026-11-03",
    }, "jobspipe")).toMatchObject({
      source: "jobspipe", locationRaw: "Bengaluru, India", sourceId: "jp1",
    });

    expect(mapApifyItem({
      id: "n1", title: "Intern", companyName: "Acme", location: "Delhi",
      jobUrl: "https://acme.in/j/1", jobDescription: "Internship", postedAt: "2026-11-04",
    }, "apify_naukri")).toMatchObject({
      source: "apify_naukri", url: "https://acme.in/j/1", company: "Acme",
      licensedFeed: true,
    });
  });

  it("maps each subscribed Actor's verified output fields", () => {
    const naukriApi = {
      field_map: {
        sourceId: ["jobId"], url: ["jdURL"], company: ["companyName"],
        description: ["jobDescription"], postedAt: ["createdDate"],
      },
    };
    expect(mapApifyItem({
      jobId: "220126040161", title: "Fresher Developer", companyName: "Acme",
      location: "Bengaluru", jdURL: "https://www.naukri.com/job-listings-fresher-220126040161",
      jobDescription: "Graduate role", createdDate: "2026-11-01 10:00:00",
    }, "apify_naukri", naukriApi)).toMatchObject({
      sourceId: "220126040161",
      url: "https://www.naukri.com/job-listings-fresher-220126040161",
      company: "Acme", postedAt: "2026-11-01 10:00:00", licensedFeed: true,
    });

    const internshalaApi = {
      field_map: {
        sourceId: ["listingId"], company: ["employer"], postedAt: ["postedText"],
      },
    };
    expect(mapApifyItem({
      listingId: "3247413", title: "Data Analytics Intern", employer: "Deep Life Savers",
      location: "Hyderabad", url: "https://internshala.com/internship/detail/3247413",
      description: "Internship", postedText: "1 day ago",
    }, "apify_internshala", internshalaApi)).toMatchObject({
      sourceId: "3247413", company: "Deep Life Savers", postedAt: "1 day ago", licensedFeed: true,
    });

    const founditApi = {
      field_map: {
        sourceId: ["jobId"], url: ["applyUrl", "url"], company: ["employer"],
        postedAt: ["postedAt", "postedAtRelative"],
      },
    };
    expect(mapApifyItem({
      jobId: "61600533", title: "Python Developer", employer: "Artech",
      location: "Bengaluru", applyUrl: "https://jobs.acme.in/61600533",
      url: "https://www.foundit.in/job/python-developer-61600533",
      postedAtRelative: "18 hours ago",
    }, "apify_foundit", founditApi)).toMatchObject({
      sourceId: "61600533", url: "https://jobs.acme.in/61600533",
      company: "Artech", postedAt: "18 hours ago", licensedFeed: true,
    });
  });

  it("maps CleanJobData's nested company and structured location", () => {
    expect(mapCleanJobDataItem({
      id: 40652107,
      title: "Graduate Software Engineer",
      company: { name: "Acme India", website_url: "https://acme.in" },
      locations: [{
        is_primary: true, display_label: "Bengaluru, Karnataka, IN",
        city_name: "Bengaluru", state_name: "Karnataka", country_name: "India",
      }],
      description: "Fresher graduate role",
      published: "2026-11-20T10:00:00.000Z",
      application_url: "https://cleanjobdata.com/apply/40652107",
    }, "cleanjobdata_in")).toMatchObject({
      source: "cleanjobdata_in", sourceId: "40652107",
      url: "https://cleanjobdata.com/apply/40652107",
      title: "Graduate Software Engineer", company: "Acme India",
      locationRaw: "Bengaluru, Karnataka, IN",
      description: "Fresher graduate role", postedAt: "2026-11-20T10:00:00.000Z",
      licensedFeed: true,
    });

    expect(mapCleanJobDataItem({
      id: 2, title: "Intern", location: "Hyderabad, India",
      application_url: "https://cleanjobdata.com/apply/2",
    }, "cleanjobdata_in")?.locationRaw).toBe("Hyderabad, India");
  });

  it("maps Fantastic.jobs ATS and job-board rows as link-back-only records", () => {
    expect(mapFantasticJobsJob({
      id: 912345,
      title: "Graduate Software Engineer",
      organization: "Acme India",
      url: "https://job-boards.greenhouse.io/acme/jobs/912345",
      locations_derived: ["Bengaluru, Karnataka, India"],
      description_text: "Graduate role",
      date_posted: "2026-11-19T08:30:00Z",
    }, "fantastic_jobs_in")).toMatchObject({
      source: "fantastic_jobs_in", sourceId: "912345",
      url: "https://job-boards.greenhouse.io/acme/jobs/912345",
      title: "Graduate Software Engineer", company: "Acme India",
      locationRaw: "Bengaluru, Karnataka, India",
      description: "Graduate role", postedAt: "2026-11-19T08:30:00Z",
      licensedFeed: true,
    });

    expect(mapFantasticJobsJob({
      id: 42, title: "SDE Intern", organization: "Globex",
      url: "https://www.linkedin.com/jobs/view/42",
      locations_alt: ["Pune, India"],
      description_text: "Internship",
    }, "fantastic_jobs_in")?.locationRaw).toBe("Pune, India");
  });

  it("rotates Fantastic.jobs endpoints and variants every 6 hours", () => {
    const api = {
      endpoints: ["/v1/active-ats", "/v1/active-jb"],
      query_variants: [{ title: "intern" }, { title: "fresher" }],
      rotation_hours: 6,
    };
    const t0 = Date.UTC(2026, 10, 20, 0, 0, 0);
    expect(fantasticJobsSelection(api, new Date(t0))).toEqual({
      endpoint: "/v1/active-ats", variant: { title: "intern" },
    });
    expect(fantasticJobsSelection(api, new Date(t0 + 6 * 3600_000))).toEqual({
      endpoint: "/v1/active-jb", variant: { title: "intern" },
    });
    expect(fantasticJobsSelection(api, new Date(t0 + 12 * 3600_000))).toEqual({
      endpoint: "/v1/active-ats", variant: { title: "fresher" },
    });
  });
});

describe("licensed adapter requests", () => {
  it("uses engine-specific location parameter for SerpApi Indeed", async () => {
    setEnv("SERPAPI_KEY", "serp-test");
    let captured: any = null;
    const client = fakeClient((_method, _url, opts) => {
      captured = opts;
      return response({ jobs_results: [{ title: "Intern", company_name: "Acme", location: "India", link: "https://in.indeed.com/viewjob?jk=1" }] });
    });
    const jobs = await new SerpApiAdapter(source("serpapi_indeed_jobs", {
      adapter: "serpapi_jobs", base_url: "https://serpapi.com/search", engine: "indeed_jobs",
      query_loop: { what: ["fresher jobs in India"], where: ["India"] },
    })).fetch(client);
    expect(captured.params.engine).toBe("indeed_jobs");
    expect(captured.params.l).toBe("India");
    expect(captured.params.location).toBeUndefined();
    expect(captured.params.api_key).toBe("serp-test");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].licensedFeed).toBe(true);
  });

  it("sends RapidAPI headers derived from the configured base URL", async () => {
    setEnv("RAPIDAPI_KEY", "rapid-test");
    let captured: any = null;
    const client = fakeClient((_method, _url, opts) => {
      captured = opts;
      return response({ jobs: [{ title: "Intern", company: "Acme", url: "https://acme.in/j/1", location: "India" }] });
    });
    await new HirebaseAdapter(source("rapidapi_hirebase", {
      base_url: "https://hirebase-jobs-data.p.rapidapi.com/v2/jobs/search", method: "POST",
    })).fetch(client);
    expect(captured.headers["X-RapidAPI-Host"]).toBe("hirebase-jobs-data.p.rapidapi.com");
    expect(captured.headers["X-RapidAPI-Key"]).toBe("rapid-test");
    expect(captured.json.geo_locations).toEqual([{ country: "India" }]);

    await new LinkedInJobsAdapter(source("rapidapi_linkedin_jobs", {
      base_url: "https://linkedin-job-search-api.p.rapidapi.com/active-jb",
    })).fetch(fakeClient((_m, _u, opts) => {
      captured = opts;
      return response([]);
    }));
    expect(captured.headers["X-RapidAPI-Host"]).toBe("linkedin-job-search-api.p.rapidapi.com");
    expect(captured.params.time_frame).toBe("24h");
  });

  it("sends a bearer token for JobsPipe", async () => {
    setEnv("JOBSPIPE_API_KEY", "jp-test");
    let captured: any = null;
    const client = fakeClient((_m, _u, opts) => {
      captured = opts;
      return response({ metadata: {}, data: [] });
    });
    await new JobspipeAdapter(source("jobspipe", {
      base_url: "https://api.jobspipe.dev/v1/jobs/search", method: "POST",
    })).fetch(client);
    expect(captured.headers.Authorization).toBe("Bearer jp-test");
    expect(captured.json.job_country_code_or).toEqual(["IN"]);
    expect(captured.json.limit).toBe(25);
  });

  it("refuses to run an Apify actor without a configured actor_id", async () => {
    const client = fakeClient(() => response([]));
    await expect(new ApifyActorAdapter(source("apify_naukri", {
      base_url: "https://api.apify.com/v2/actors", method: "POST", actor_id: "",
    })).fetch(client)).rejects.toThrow(/actor_id/);
  });

  it("calls the verified Apify sync dataset endpoint with the configured actor", async () => {
    setEnv("APIFY_TOKEN", "apify-test");
    const captured: { value?: { url: string; opts: any } } = {};
    const client = fakeClient((_m, url, opts) => {
      captured.value = { url, opts };
      return response([{
        jobId: "n1", title: "Intern", companyName: "Acme",
        jdURL: "https://www.naukri.com/job-listings-n1", createdDate: "2026-11-20",
      }]);
    });
    const jobs = await new ApifyActorAdapter(source("apify_naukri", {
      base_url: "https://api.apify.com/v2/actors", method: "POST",
      actor_id: "parsebird/naukri-jobs-scraper",
      input: { maxJobs: 100, fetchDetails: false },
      input_loop: { keyword: ["fresher", "internship"] },
      field_map: { url: ["jdURL"] },
    })).fetch(client);
    expect(captured.value?.url).toBe(
      "https://api.apify.com/v2/actors/parsebird/naukri-jobs-scraper/run-sync-get-dataset-items",
    );
    expect(captured.value?.opts.params.timeout).toBe(300);
    expect(captured.value?.opts.timeoutMs).toBe(300_000);
    expect(captured.value?.opts.json).toMatchObject({ maxJobs: 100, fetchDetails: false });
    expect(["fresher", "internship"]).toContain(captured.value?.opts.json.keyword);
    expect(captured.value?.opts.headers.Authorization).toBe("Bearer apify-test");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].licensedFeed).toBe(true);
  });

  it("calls CleanJobData /jobs with India filters and follows the cursor", async () => {
    setEnv("CLEANJOBDATA_API_KEY", "cjd-test");
    const calls: any[] = [];
    let n = 0;
    const client = fakeClient((_m, _url, opts) => {
      calls.push(opts);
      n += 1;
      return response({
        data: [{
          id: n, title: n === 1 ? "Fresher Developer" : "Graduate Trainee",
          company: { name: "Acme" }, location: "Bengaluru, India",
          description: "Graduate role", published: "2026-11-20",
          application_url: `https://cleanjobdata.com/apply/${n}`,
        }],
        pagination: { next_page: n === 1 ? "cursor-2" : null },
      });
    });
    const jobs = await new CleanJobDataAdapter(source("cleanjobdata_in", {
      base_url: "https://api.cleanjobdata.com/jobs",
      adapter: "cleanjobdata",
      query: { location: "IN", max_age: "30d", limit: 20, extra_fields: "description" },
      query_variants: [{ title: "fresher", experience_level: "EN" }],
      pages_per_variant: 2,
    })).fetch(client);
    expect(calls).toHaveLength(2);
    expect(calls[0].params).toMatchObject({
      location: "IN", max_age: "30d", limit: 20, extra_fields: "description",
      title: "fresher", experience_level: "EN",
    });
    expect(calls[1].params.cursor).toBe("cursor-2");
    expect(calls[0].headers.Authorization).toBe("Bearer cjd-test");
    expect(jobs).toHaveLength(2);
    expect(jobs[0].licensedFeed).toBe(true);
  });

  it("calls the Fantastic.jobs job-board endpoint with Bearer auth and India fresher filters", async () => {
    setEnv("FANTASTIC_JOBS_API_KEY", "fj-test");
    const captured: { value?: { url: string; opts: any } } = {};
    const client = fakeClient((_m, url, opts) => {
      captured.value = { url, opts };
      return response([{
        id: 77,
        title: "SDE Intern",
        organization: "Acme",
        url: "https://www.linkedin.com/jobs/view/77",
        locations_derived: ["Bengaluru, India"],
        description_text: "Internship",
        date_posted: "2026-11-19",
      }]);
    });
    const jobs = await new FantasticJobsAdapter(source("fantastic_jobs_in", {
      base_url: "https://data.fantastic.jobs",
      adapter: "fantastic_jobs",
      endpoints: ["/v1/active-jb"],
      query_variants: [{ title: "intern", ai_employment_type: "INTERN" }],
      params_example: {
        time_frame: "7d", limit: 10, description_format: "text",
        location: "India", ai_experience_level: "0-2",
      },
    })).fetch(client);
    expect(captured.value?.url).toBe("https://data.fantastic.jobs/v1/active-jb");
    expect(captured.value?.opts.headers.Authorization).toBe("Bearer fj-test");
    expect(captured.value?.opts.params).toMatchObject({
      time_frame: "7d", limit: 10, description_format: "text",
      location: "India", ai_experience_level: "0-2",
      title: "intern", ai_employment_type: "INTERN",
      exclude_recruiter_fields: "true",
    });
    expect(jobs).toMatchObject([{
      source: "fantastic_jobs_in", sourceId: "77",
      url: "https://www.linkedin.com/jobs/view/77",
      company: "Acme", locationRaw: "Bengaluru, India",
      licensedFeed: true,
    }]);
  });
});

describe("registry wiring", () => {
  it("resolves every new source id to an adapter", () => {
    const cases: [string, unknown][] = [
      ["serpapi_google_jobs", SerpApiAdapter],
      ["serpapi_indeed_jobs", SerpApiAdapter],
      ["serpapi_glassdoor_jobs", SerpApiAdapter],
      ["rapidapi_hirebase", HirebaseAdapter],
      ["rapidapi_linkedin_jobs", LinkedInJobsAdapter],
      ["jobspipe", JobspipeAdapter],
      ["cleanjobdata_in", CleanJobDataAdapter],
      ["fantastic_jobs_in", FantasticJobsAdapter],
      ["apify_naukri", ApifyActorAdapter],
      ["apify_internshala", ApifyActorAdapter],
      ["apify_foundit", ApifyActorAdapter],
    ];
    for (const [id, ctor] of cases) {
      const adapter = getAdapter(source(id, {
        adapter: id.startsWith("apify_") ? "apify_actor"
          : id.startsWith("serpapi_") ? "serpapi_jobs"
          : id.startsWith("cleanjobdata_") ? "cleanjobdata"
          : id.startsWith("fantastic_jobs_") ? "fantastic_jobs"
          : id,
        engine: "google_jobs",
      }));
      expect(adapter).toBeInstanceOf(ctor as any);
    }
  });
});

describe("licensed feed blocklist exception", () => {
  const base = {
    source: "test", url: "https://www.indeed.com/viewjob?jk=1",
    title: "Software Intern", company: "Acme", locationRaw: "Bengaluru, India",
  };

  it("still rejects blocklisted URLs from ordinary adapters", () => {
    expect(prefilter(base).reject).toBe("blocklisted_url");
  });

  it("allows blocklisted URLs only when marked as a licensed feed", () => {
    expect(prefilter({ ...base, licensedFeed: true }).reject).toBeNull();
  });

  it("keeps Apify actor URLs as link-back-only records", () => {
    const mapped = mapApifyItem({
      jobId: "n1", title: "Fresher Developer", companyName: "Acme",
      location: "India", jdURL: "https://www.naukri.com/job-listings-n1",
    }, "apify_naukri", { field_map: { url: ["jdURL"] } });
    expect(mapped?.url).toBe("https://www.naukri.com/job-listings-n1");
    expect(mapped?.licensedFeed).toBe(true);
    expect(prefilter({ ...base, ...mapped! }).reject).toBeNull();
  });

  it("keeps Fantastic.jobs LinkedIn URLs as link-back-only records", () => {
    const mapped = mapFantasticJobsJob({
      id: 77, title: "SDE Intern", organization: "Acme",
      url: "https://www.linkedin.com/jobs/view/77",
      locations_derived: ["Bengaluru, India"],
    }, "fantastic_jobs_in");
    expect(mapped?.licensedFeed).toBe(true);
    expect(prefilter({ ...base, ...mapped! }).reject).toBeNull();
  });
});
