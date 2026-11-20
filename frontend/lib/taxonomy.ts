export const ROLES = [
  "software_engineering", "frontend", "backend", "fullstack", "mobile",
  "data_analytics", "data_science_ml", "devops_cloud", "qa_testing",
  "product_management", "design_ux", "marketing", "sales_bizdev",
  "content_writing", "hr_recruiting", "finance_accounting",
  "operations_supply_chain", "customer_support", "core_engineering", "other",
] as const;

export const CITIES = [
  "Bengaluru", "Mumbai", "Delhi_NCR", "Hyderabad", "Pune", "Chennai",
  "Kolkata", "Ahmedabad", "Jaipur", "Chandigarh", "Kochi", "Indore",
  "Other_India", "Remote_India", "Multiple", "Unknown",
] as const;

export const JOB_TYPES = ["internship", "fresher_fulltime", "apprenticeship", "other"] as const;

export type Role = (typeof ROLES)[number];
export type City = (typeof CITIES)[number];
export type JobType = (typeof JOB_TYPES)[number];