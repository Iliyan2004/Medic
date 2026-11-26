// English / Urdu strings. Urdu covers navigation, key actions and emergency flows;
// remaining screens fall back to English (see README: translation backlog).
const en = {
  nav_home: 'Home', nav_pharmacy: 'Pharmacy', nav_insurance: 'Insurance', nav_support: 'Support', nav_map: 'Map',
  nav_community: 'Community', nav_emergency: 'Emergency', nav_records: 'Records', nav_energy: 'Energy', nav_privacy: 'Privacy', nav_care: 'My care', nav_geo: 'Health map',
  workspace: 'Workspace', nav_work_doctor: 'My patients', nav_work_pharmacist: 'Pharmacy desk', nav_work_insurer: 'Claims desk',
  nav_work_dispatch: 'Dispatch board', nav_work_facility: 'My facility', nav_work_programs: 'Programmes & PPP', nav_work_admin: 'Admin',
  sign_in: 'Sign in', sign_out: 'Sign out', create_account: 'Create account', loading: 'Loading…', not_found: 'Page not found',
  signin_needed: 'Please sign in', signin_needed_body: 'You need an account for this. It takes one minute and only needs your phone number.',
  offline_error: 'You seem to be offline. Check your connection and try again.',
  low_data: 'Low-data mode', low_data_on: 'Low-data mode on: maps and images are off', low_data_off: 'Low-data mode off',
  phone: 'Mobile number', password: 'Password', name: 'Full name', cnic: 'CNIC', province: 'Province', city: 'City',
  sos_title: 'Need an ambulance?', sos_sub: 'One tap — we send the fastest one from any service',
  call_1122: 'Call 1122', call_115: 'Call 115', request_ambulance: 'Request ambulance', share_location: 'Use my location',
  severity: 'How serious is it?', sev_1: 'Critical — not breathing, unconscious, heavy bleeding', sev_2: 'Serious — chest pain, stroke signs, major injury',
  sev_3: 'Urgent — fracture, high fever, labour', sev_4: 'Minor — needs transport only',
  what_happened: 'What happened?', contact_phone: 'Phone number for the crew', ambulance_coming: 'Ambulance is on the way',
  eta: 'ETA', minutes: 'min', free: 'Free', cancel: 'Cancel', save: 'Save', submit: 'Submit', search: 'Search', add_to_cart: 'Add to cart',
  cart: 'Cart', checkout: 'Checkout', rx_required: 'Prescription needed', otc: 'No prescription', in_stock: 'in stock', out_of_stock: 'Out of stock',
  check_eligibility: 'Check what support I can get', donate: 'Donate', my_records: 'My health record', notifications: 'Notifications',
  st_awaiting_rx: 'awaiting prescription check', st_under_review: 'under review', st_auto_approved: 'approved instantly',
};
const ur = {
  nav_home: 'ہوم', nav_pharmacy: 'فارمیسی', nav_insurance: 'انشورنس', nav_support: 'مالی مدد', nav_map: 'نقشہ',
  nav_community: 'کمیونٹی', nav_emergency: 'ایمرجنسی', nav_records: 'ریکارڈ', nav_energy: 'توانائی', nav_privacy: 'رازداری', nav_care: 'میری دیکھ بھال', nav_geo: 'صحت کا نقشہ',
  workspace: 'ورک اسپیس', nav_work_doctor: 'میرے مریض', nav_work_pharmacist: 'فارمیسی ڈیسک', nav_work_insurer: 'کلیم ڈیسک',
  nav_work_dispatch: 'ڈسپیچ بورڈ', nav_work_facility: 'میرا ہسپتال', nav_work_programs: 'پروگرام اور پی پی پی', nav_work_admin: 'ایڈمن',
  sign_in: 'سائن اِن', sign_out: 'سائن آؤٹ', create_account: 'اکاؤنٹ بنائیں', loading: 'لوڈ ہو رہا ہے…', not_found: 'صفحہ نہیں ملا',
  signin_needed: 'براہِ کرم سائن اِن کریں', signin_needed_body: 'اس کے لیے اکاؤنٹ ضروری ہے۔ صرف موبائل نمبر سے ایک منٹ میں بن جاتا ہے۔',
  offline_error: 'آپ آف لائن ہیں۔ انٹرنیٹ چیک کر کے دوبارہ کوشش کریں۔',
  low_data: 'کم ڈیٹا موڈ', low_data_on: 'کم ڈیٹا موڈ آن: نقشے اور تصاویر بند', low_data_off: 'کم ڈیٹا موڈ بند',
  phone: 'موبائل نمبر', password: 'پاس ورڈ', name: 'پورا نام', cnic: 'شناختی کارڈ نمبر', province: 'صوبہ', city: 'شہر',
  sos_title: 'ایمبولینس چاہیے؟', sos_sub: 'ایک ٹیپ — کسی بھی سروس کی سب سے قریبی ایمبولینس',
  call_1122: '1122 پر کال کریں', call_115: '115 پر کال کریں', request_ambulance: 'ایمبولینس بلائیں', share_location: 'میری لوکیشن استعمال کریں',
  severity: 'حالت کتنی سنگین ہے؟', sev_1: 'انتہائی سنگین — سانس نہیں، بے ہوش، شدید خون بہنا', sev_2: 'سنگین — سینے میں درد، فالج کی علامات، بڑی چوٹ',
  sev_3: 'فوری — ہڈی ٹوٹنا، تیز بخار، زچگی', sev_4: 'معمولی — صرف ہسپتال پہنچانا ہے',
  what_happened: 'کیا ہوا؟', contact_phone: 'عملے کے لیے فون نمبر', ambulance_coming: 'ایمبولینس آ رہی ہے',
  eta: 'پہنچنے کا وقت', minutes: 'منٹ', free: 'مفت', cancel: 'منسوخ', save: 'محفوظ کریں', submit: 'جمع کریں', search: 'تلاش', add_to_cart: 'کارٹ میں ڈالیں',
  cart: 'کارٹ', checkout: 'آرڈر کریں', rx_required: 'نسخہ ضروری', otc: 'بغیر نسخہ', in_stock: 'دستیاب', out_of_stock: 'ختم',
  check_eligibility: 'دیکھیں مجھے کون سی مدد مل سکتی ہے', donate: 'عطیہ دیں', my_records: 'میرا صحت ریکارڈ', notifications: 'اطلاعات',
};
let lang = 'en';
export const setLang = (l) => { lang = l === 'ur' ? 'ur' : 'en'; };
export const getLang = () => lang;
export const t = (k) => (lang === 'ur' && ur[k]) || en[k] || k;
