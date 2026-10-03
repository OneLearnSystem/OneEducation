// Small, local SVG icon set. No font downloads or external icon service.
const paths={
 home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
 people:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3zM16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5v2"/>',
 register:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 11l2 2 4-4M9 17h6"/>',
 calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18m-13 4h2m4 0h2m-8 3h2"/>',
 book:'<path d="M12 5C8 2 4 3 2 4v16c4-2 7-1 10 1 3-2 6-3 10-1V4c-3-1-7-2-10 1Zm0 0v16"/>',
 chart:'<path d="M3 3v18h19M7 17v-5m5 5V8m5 9V4"/>',
 shield:'<path d="m12 2 9 4v6c0 5-5 8-9 10-4-2-9-5-9-10V6zM8 12l3 3 5-6"/>',
 bell:'<path d="M5 9a7 7 0 0 1 14 0v6l2 3H3l2-3zm4 12h6"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
 trophy:'<path d="M8 3h8v6a4 4 0 0 1-8 0zM8 5H3v3a4 4 0 0 0 5 4m8-7h5v3a4 4 0 0 1-5 4m-4 1v5m-4 3h8m-6-3h4"/>',
 alert:'<path d="m12 3 10 18H2zM12 9v5m0 3v1"/>',
 settings:'<path d="m9 3-1 3-3 1-2 3 2 2-1 3 2 3 3-1 2 3h3l1-3 3-1 2-3-2-2 1-3-2-3-3 1-2-3z"/><circle cx="11" cy="11" r="3"/>',
 building:'<path d="M4 21V7l8-4 8 4v14M2 21h20M9 21v-5h6v5M8 9h1m6 0h1m-8 3h1m6 0h1"/>',
 folder:'<path d="M3 20V4h7l2 3h9v13z"/>',
 file:'<path d="M5 2h9l5 5v15H5zM14 2v6h5M9 12h6m-6 4h6"/>',
 search:'<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
 arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
 chevron:'<path d="m9 5 7 7-7 7"/>',
 menu:'<path d="M3 6h18M3 12h18M3 18h18"/>',
 refresh:'<path d="M20 7a9 9 0 0 0-16 2m0-6v6h6m-6 8a9 9 0 0 0 16-2m0 6v-6h-6"/>',
 move:'<path d="M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4"/>',
 logout:'<path d="M9 3H3v18h6m4-5 5-4-5-4m-6 4h14"/>',
 plus:'<path d="M12 4v16M4 12h16"/>',
 lock:'<rect x="4" y="10" width="16" height="12" rx="2"/><path d="M7 10V7a5 5 0 0 1 10 0v3m-5 5v3"/>',
 mail:'<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 5 10 8L22 5"/>',
 help:'<circle cx="12" cy="12" r="10"/><path d="M9 8a3 3 0 1 1 5 3c-2 1-2 2-2 3m0 3v1"/>',
 star:'<path d="m12 2 3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/>',
 wallet:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 8V4l14-2v3m4 7h-6v5h6m-3-3h.1"/>',
 check:'<path d="m4 12 5 5L20 6"/>'
};
const aliases={students:'people','pupil-records':'people',tutors:'people','manage-staff':'people','staff-accounts':'shield','manage-pupils':'plus','manage-sats':'chart','class-allocation':'move',classes:'book','manage-classes':'book','manage-timetable':'calendar',attendance:'register',homework:'book',revision:'book',exams:'file',cover:'refresh',availability:'clock',behaviour:'trophy',detentions:'alert',oncall:'bell',reports:'chart',evenings:'calendar',activities:'star',campus:'building','manage-rooms':'building','manage-houses':'trophy',school:'building',admin:'shield','manage-policies':'settings',funding:'wallet','lockdown-control':'lock',staffhub:'folder',helpdesk:'help',timetable:'calendar',notices:'bell'};
export function icon(name,cls=''){return `<svg class="oe-icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[aliases[name]||name]||paths.folder}</svg>`}
