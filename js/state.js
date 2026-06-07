const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ');

const CAL_API         = 'https://www.googleapis.com/calendar/v3';
const CLAUDE_API      = 'https://api.anthropic.com/v1/messages';
const MODEL           = 'claude-haiku-4-5-20251001';
const MODEL_SMART     = 'claude-sonnet-4-6'; // used for routing (calendar vs todo)
const WEEK_START_HOUR = 7;
const WEEK_END_HOUR   = 22;
const HOUR_PX         = 44;

let config            = {};
let gapiToken         = null;
let recognition       = null;
let isRecording       = false;
let uploadedImage     = null;
let calEvents7        = [];
let calEventsYear     = null;
let proposedEvents    = [];
let selectedProposals = new Set();
let currentView       = 'week';
let currentDayDate    = new Date();
let currentWeekOffset     = 0; // weeks relative to today
let currentThreeDayOffset = 0; // 3-day periods relative to today
let currentMonthOffset    = 0; // months relative to today
let currentYearOffset     = 0; // years relative to today
let allCalendars      = [];
let enabledCalendars  = new Set();
let todos             = []; // { id, text, done, scheduled, createdAt }
