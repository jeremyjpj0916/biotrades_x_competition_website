export const rulesVersion = 1;
export const ruleSections = [
  [
    "Entry and eligibility",
    "Enter one US-listed biotech or pharmaceutical common stock per season. US-listed ordinary shares and sponsored ADRs may qualify. ETFs, options, warrants, preferred shares and inactive listings are ineligible. There is no minimum market cap or share price. Multiple participants may pick the same security.",
  ],
  [
    "Registration and reveal",
    "Entries open December 1 at midnight Eastern and lock at the opening bell of the first regular US equity session. You can change or withdraw your pick while entry is open. Picks become public at the deadline. If a security loses eligibility before the first session, the entry is marked unranked after review.",
  ],
  [
    "How we score",
    "We start with the regular-session open on the first trading day and update using verified daily closes. Return is the change in the equivalent value of one original share, divided by its opening price. The final trading day supplies the final value. Missing prices remain pending. Ties share ranks and may skip subsequent ranks, for example 1, 1, 3.",
  ],
  [
    "Corporate actions",
    "Splits and reverse splits change share quantity. Symbol changes retain the original security identity. Cash deals retain verified proceeds and stock deals track successor shares. Mixed deals do both. Halted shares use the last verified close until trading resumes. Delistings and bankruptcies require documented valuation or confirmed cancellation. Ordinary cash dividends are excluded. Special distributions, spin-offs and contingent rights count only at their verified cash or observable successor share value. Unresolved terms block finalization.",
  ],
  [
    "Annual trophies",
    "Champion, silver and bronze go to ranks one, two and three. Elite Stock Picker goes to everyone ranked within the top 10%, rounded up with a minimum of one. All ties at the cutoff qualify. Trophies are published with the official final results.",
  ],
  [
    "Access and corrections",
    "The competition is free and hypothetical. Moderators may suspend abusive accounts. Final results are preserved by revision. Any correction includes a public reason. Public picks and returns remain in historical records in anonymized form after account deletion.",
  ],
] as const;

export const freeScoringRule =
  "The first reported regular-session trade on opening day establishes the starting value. Each session's last reported regular-session trade updates the equivalent value of one original share. We divide that change by the starting value to compute return. Data typically arrives about 48 hours after each session. The last session determines final return. Missing prices remain pending, and ties share ranks.";
