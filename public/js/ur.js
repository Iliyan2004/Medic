// Urdu UI layer. Loaded ONLY when the user switches to Urdu (English users never download it).
// Translates exact UI phrases in text nodes and in placeholder / aria-label / title attributes as screens render.
// Only whole, known UI phrases are replaced, so user content (names, posts, medicine names) is never altered.
// NOTE: machine-assisted draft — have a native Urdu speaker (ideally a health communicator) review before launch.

const P = {
  // ── Common ──
  'Details': 'تفصیل', 'Details +': 'تفصیل', 'More': 'مزید', 'Loading…': 'لوڈ ہو رہا ہے…', 'Nothing yet.': 'ابھی کچھ نہیں۔', 'None': 'کوئی نہیں', 'None.': 'کوئی نہیں۔',
  'All': 'سب', 'Other': 'دیگر', 'Name': 'نام', 'Type': 'قسم', 'Title': 'عنوان', 'Date': 'تاریخ', 'Status': 'حالت', 'Notes': 'نوٹس', 'Note': 'نوٹ',
  'Open': 'کھولیں', 'Check': 'چیک کریں', 'Create': 'بنائیں', 'Update': 'اپ ڈیٹ کریں', 'Remove': 'ہٹائیں', 'Publish': 'شائع کریں', 'Approve': 'منظور کریں',
  'Reject': 'مسترد کریں', 'Revoke': 'واپس لیں', 'Report': 'رپورٹ کریں', 'Reply': 'جواب دیں', 'Post': 'پوسٹ کریں', 'Use': 'استعمال کریں', 'Pay': 'ادائیگی',
  'Calculate': 'حساب لگائیں', 'Search': 'تلاش', 'See all': 'سب دیکھیں', 'delete': 'حذف کریں', 'Source': 'ذریعہ', 'Preview': 'جھلک', 'Code': 'کوڈ',
  'When': 'کب', 'Who': 'کس نے', 'What': 'کیا', 'Why': 'کیوں', 'How long': 'کتنی دیر', 'Data': 'ڈیٹا', 'Purpose': 'مقصد', 'Reason': 'وجہ',
  'City': 'شہر', 'Province': 'صوبہ', 'All cities': 'تمام شہر', 'Gender': 'جنس', 'Female': 'خاتون', 'Male': 'مرد', 'Prefer not to say': 'نہیں بتانا چاہتے',
  'Birth year': 'سالِ پیدائش', 'Blood group': 'بلڈ گروپ', 'Profile': 'پروفائل', 'Mobile': 'موبائل', 'Patient': 'مریض', 'Doctor': 'ڈاکٹر',
  'Medicine': 'دوا', 'Medicines': 'دوائیں', 'Dosage': 'خوراک', 'Price': 'قیمت', 'Payment': 'ادائیگی', 'Card': 'کارڈ', 'Cash on delivery': 'ڈیلیوری پر نقد',
  'Low': 'کم', 'low': 'کم', 'medium': 'درمیانہ', 'high': 'زیادہ', 'critical': 'انتہائی سنگین', 'Severity': 'شدت',
  'Built for Pakistan': 'پاکستان کے لیے بنایا گیا', 'Try the demo': 'ڈیمو آزمائیں', 'Payment is simulated.': 'ادائیگی فرضی ہے (ڈیمو)۔',
  'Payments are simulated in this prototype.': 'اس نمونے میں ادائیگیاں فرضی ہیں۔', 'Learn more': 'مزید جانیں', 'About this data': 'اس ڈیٹا کے بارے میں',
  'Why this works': 'یہ کیسے کام کرتا ہے', 'How it works': 'یہ کیسے کام کرتا ہے',

  // ── Home ──
  'Your health, in one place': 'آپ کی صحت، ایک ہی جگہ',
  'Medicines, insurance, support, hospitals and your record — simple and secure.': 'دوائیں، انشورنس، مالی مدد، ہسپتال اور آپ کا ریکارڈ — آسان اور محفوظ۔',
  'More services': 'مزید سروسز', 'Map, community, energy, privacy': 'نقشہ، کمیونٹی، توانائی، رازداری',
  'Order from licensed pharmacies': 'لائسنس یافتہ فارمیسی سے منگوائیں', 'Plans, Sehat Card & claims': 'پلان، صحت کارڈ اور کلیم',
  'Financial help': 'مالی مدد', 'Zakat, CSR & govt. support': 'زکوٰۃ، کمپنی اور سرکاری مدد', 'Health record': 'صحت ریکارڈ',
  'Encrypted, you control it': 'محفوظ (انکرپٹڈ)، اختیار آپ کا', 'Hospitals & camps': 'ہسپتال اور کیمپ', 'Find care near you': 'قریب علاج تلاش کریں',
  'Ask verified doctors': 'تصدیق شدہ ڈاکٹروں سے پوچھیں', 'Clinic energy': 'کلینک کی بجلی', 'Power & vaccine fridges': 'بجلی اور ویکسین فریج',
  'Privacy': 'رازداری', 'Your data, your rights': 'آپ کا ڈیٹا، آپ کے حقوق', 'Insurance': 'انشورنس', 'Community': 'کمیونٹی',
  'Order it': 'منگوائیں', '. Staff demo accounts are listed on the sign-in page.': '۔ عملے کے ڈیمو اکاؤنٹس سائن اِن صفحے پر ہیں۔',
  'Sign in as a patient with': 'مریض کے طور پر سائن اِن کریں:',

  // ── Auth / account ──
  'New here?': 'نئے ہیں؟', 'Demo accounts': 'ڈیمو اکاؤنٹس', 'All data is fictional. Tap one to fill the form.': 'تمام ڈیٹا فرضی ہے۔ فارم بھرنے کے لیے کسی ایک کو دبائیں۔',
  'Staff accounts': 'عملے کے اکاؤنٹس', 'Just your name, phone and a password.': 'صرف آپ کا نام، فون اور پاس ورڈ۔', '(8+ characters)': '(کم از کم 8 حروف)',
  'Optional: CNIC, gender, location': 'اختیاری: شناختی کارڈ، جنس، مقام',
  'Your CNIC lets us check Sehat Card and support programmes for you. We never store the CNIC itself.': 'شناختی کارڈ سے ہم آپ کے لیے صحت کارڈ اور امدادی پروگرام چیک کرتے ہیں۔ ہم شناختی کارڈ نمبر خود محفوظ نہیں کرتے۔',
  'I have read the': 'میں نے پڑھ لیا ہے', 'privacy notice': 'رازداری نوٹس',
  '. I understand my health data is encrypted and shared only with my consent.': '۔ میں سمجھتا/سمجھتی ہوں کہ میرا صحت ڈیٹا محفوظ ہے اور صرف میری اجازت سے شیئر ہوتا ہے۔',
  '(needed for Sehat Card & support checks)': '(صحت کارڈ اور امداد چیک کے لیے ضروری)', 'Notify me when someone nearby needs my blood type': 'جب قریب کسی کو میرے گروپ کا خون چاہیے ہو تو مجھے بتائیں',
  'Two-step sign-in': 'دو مرحلہ سائن اِن', 'Turn on': 'آن کریں', 'Turn off': 'بند کریں', 'Set up': 'سیٹ اپ کریں', 'On': 'آن', 'Off': 'بند', 'Recommended': 'تجویز کردہ',
  'Code from your authenticator app': 'آتھنٹیکیٹر ایپ کا کوڈ', 'Current code': 'موجودہ کوڈ', 'Or type this key:': 'یا یہ کلید لکھیں:',
  'Enter the 6-digit code it shows:': 'ایپ میں دکھایا گیا 6 ہندسوں کا کوڈ لکھیں:', 'tap here to add it': 'شامل کرنے کے لیے یہاں دبائیں',

  // ── Pharmacy ──
  'Shop': 'دکان', 'Prescriptions': 'نسخے', 'My orders': 'میرے آرڈر', 'Is my medicine genuine?': 'کیا میری دوا اصلی ہے؟',
  'How ordering works': 'آرڈر کیسے ہوتا ہے', 'Licensed pharmacies · pharmacist-checked': 'لائسنس یافتہ فارمیسی · فارماسسٹ کی جانچ',
  'All categories': 'تمام اقسام', 'Search medicine or generic name, e.g. paracetamol': 'دوا یا جنرک نام تلاش کریں، مثلاً پیراسیٹامول',
  'All pharmacies are licensed and checked. Prescription medicines are dispensed only after a pharmacist checks your prescription, as provincial Drug Rules require. Prices are capped at the printed retail price (MRP).': 'تمام فارمیسیاں لائسنس یافتہ اور جانچی ہوئی ہیں۔ نسخے والی دوائیں صوبائی ڈرگ رولز کے مطابق فارماسسٹ کی جانچ کے بعد ہی دی جاتی ہیں۔ قیمت پرنٹ شدہ قیمت (MRP) سے زیادہ نہیں ہوتی۔',
  'Full details & cheaper alternatives →': 'مکمل تفصیل اور سستے متبادل ←', 'No medicines match your search.': 'آپ کی تلاش سے کوئی دوا نہیں ملی۔',
  'Not sold online': 'آن لائن دستیاب نہیں', 'Visit pharmacy': 'فارمیسی جائیں', 'Medicine details': 'دوا کی تفصیل',
  'Manufacturer': 'بنانے والی کمپنی', 'DRAP registration': 'ڈریپ رجسٹریشن', 'Schedule': 'شیڈول', 'Storage': 'محفوظ کرنا', '❄️ 2–8°C cold chain': '❄️ 2–8°C ٹھنڈا رکھیں',
  '💡 Same medicine, lower price': '💡 وہی دوا، کم قیمت', 'Where it’s in stock': 'کہاں دستیاب ہے',
  'Same generic and strength from another DRAP-registered maker. Ask your doctor or pharmacist before switching.': 'وہی جنرک اور طاقت، کسی دوسری ڈریپ رجسٹرڈ کمپنی کی۔ بدلنے سے پہلے ڈاکٹر یا فارماسسٹ سے پوچھیں۔',
  'Your cart is empty.': 'آپ کی کارٹ خالی ہے۔', 'Browse medicines': 'دوائیں دیکھیں', 'Pharmacy': 'فارمیسی', 'Prescription': 'نسخہ', 'Choose…': 'منتخب کریں…',
  'No prescription yet?': 'ابھی نسخہ نہیں؟', 'Add one': 'شامل کریں', '. A pharmacist checks it before dispensing.': '۔ دوا دینے سے پہلے فارماسسٹ اسے چیک کرتا ہے۔',
  'Pay with support programme': 'امدادی پروگرام سے ادائیگی', 'Can’t afford it?': 'استطاعت نہیں؟', 'Check if you qualify for free medicines': 'دیکھیں کیا آپ مفت دواؤں کے اہل ہیں',
  'Delivery address': 'ڈیلیوری کا پتہ', 'House, street, area, city': 'مکان، گلی، علاقہ، شہر', 'Fetching price…': 'قیمت معلوم کی جا رہی ہے…', 'Place order': 'آرڈر دیں', 'You pay': 'آپ ادا کریں گے',
  'My prescriptions': 'میرے نسخے', 'Order these medicines': 'یہ دوائیں منگوائیں', 'No prescriptions yet.': 'ابھی کوئی نسخہ نہیں۔', '+ Add a paper prescription': '+ کاغذی نسخہ شامل کریں',
  'Type what is on your doctor’s prescription. Keep the paper — the pharmacist or rider will collect the original, as Drug Rules require for prescription medicines.': 'ڈاکٹر کے نسخے پر جو لکھا ہے وہ درج کریں۔ کاغذ سنبھال کر رکھیں — ڈرگ رولز کے مطابق فارماسسٹ یا رائیڈر اصل نسخہ لے گا۔',
  'Quantity (packs)': 'مقدار (پیک)', 'Doctor & notes': 'ڈاکٹر اور نوٹس', 'Dr. name, clinic, date': 'ڈاکٹر کا نام، کلینک، تاریخ', 'e.g. 1 tab twice daily': 'مثلاً 1 گولی دن میں دو بار',
  '📷 Photo of the prescription': '📷 نسخے کی تصویر', '(recommended — helps the pharmacist approve faster)': '(تجویز کردہ — فارماسسٹ جلد منظوری دے سکتا ہے)',
  'Encrypted and only shown to you and the pharmacist who fills your order.': 'محفوظ (انکرپٹڈ) — صرف آپ اور آرڈر تیار کرنے والا فارماسسٹ دیکھ سکتا ہے۔',
  'Save prescription': 'نسخہ محفوظ کریں', '📷 Photo': '📷 تصویر', 'No photo attached.': 'کوئی تصویر نہیں۔', 'Loading photo…': 'تصویر لوڈ ہو رہی ہے…',
  'No orders yet.': 'ابھی کوئی آرڈر نہیں۔', 'Check a medicine pack': 'دوا کا پیک چیک کریں', 'Type the code printed next to the 2D barcode.': '2D بارکوڈ کے ساتھ چھپا کوڈ لکھیں۔',
  'Since 9 October 2026, DRAP requires a 2D barcode (GS1 DataMatrix) with a unique serial number on medicine packs. Scan it with your phone camera, or type the code printed next to it.': '9 اکتوبر 2026 سے ڈریپ کے مطابق ہر دوا کے پیک پر منفرد سیریل نمبر والا 2D بارکوڈ لازمی ہے۔ فون کیمرے سے اسکین کریں یا ساتھ چھپا کوڈ لکھیں۔',
  'Try a demo code:': 'ڈیمو کوڈ آزمائیں:', 'genuine': 'اصلی', 'recalled': 'واپس منگوایا گیا', 'unknown': 'نامعلوم',
  'Report suspected fake or substandard medicine to DRAP.': 'جعلی یا غیر معیاری دوا کی اطلاع ڈریپ کو دیں۔',
  'Prototype: checks Sehatyab’s serial registry, standing in for the DRAP/GS1 traceability system.': 'نمونہ: یہ صحت یاب کی سیریل رجسٹری چیک کرتا ہے جو ڈریپ/GS1 نظام کی جگہ ہے۔',

  // ── Insurance ──
  'Health insurance': 'صحت انشورنس', 'Cover for what Sehat Card doesn’t pay.': 'اُن اخراجات کی کوریج جو صحت کارڈ ادا نہیں کرتا۔', 'Takaful': 'تکافل', 'Conventional': 'روایتی',
  '/ month': '/ ماہانہ', 'Get this plan': 'یہ پلان لیں', 'Insurer': 'انشورنس کمپنی', 'Per day': 'روزانہ', 'OPD/medicines': 'او پی ڈی/دوائیں', 'Waiting period': 'انتظار کی مدت',
  'Compare plans': 'پلان کا موازنہ', 'Sehat Card check': 'صحت کارڈ چیک', 'My policies': 'میری پالیسیاں', 'My claims': 'میرے کلیم', '+ Sehat Card': '+ صحت کارڈ',
  'Family members (optional)': 'گھر کے افراد (اختیاری)', 'Spouse': 'شریکِ حیات', 'Child': 'بچہ', 'Parent': 'والدین', 'Pay first premium with': 'پہلا پریمیم ادا کریں بذریعہ',
  'Employer (optional — some employers pay the premium)': 'آجر (اختیاری — کچھ آجر پریمیم ادا کرتے ہیں)', 'Confirm & pay': 'تصدیق اور ادائیگی',
  'You can cancel within 14 days for a full refund (free-look period). Payment is simulated.': 'آپ 14 دن کے اندر منسوخ کر کے پوری رقم واپس لے سکتے ہیں۔ ادائیگی فرضی ہے۔',
  'Sehat Card': 'صحت کارڈ', 'See matching plans': 'موزوں پلان دیکھیں', 'Find empanelled hospitals': 'پینل والے ہسپتال تلاش کریں', 'About this check': 'اس جانچ کے بارے میں', 'Update profile': 'پروفائل اپ ڈیٹ کریں',
  'Make a claim': 'کلیم کریں', 'You have no policies yet.': 'آپ کی ابھی کوئی پالیسی نہیں۔', 'Policy': 'پالیسی', '+ New claim': '+ نیا کلیم', 'Simple claims approved in seconds': 'سادہ کلیم سیکنڈوں میں منظور',
  'Doctor visit / tests (OPD)': 'ڈاکٹر کا معائنہ / ٹیسٹ (او پی ڈی)', 'Hospital cash (nights in hospital)': 'ہسپتال کیش (ہسپتال میں راتیں)',
  'Cashless hospital admission (pre-approval)': 'بغیر نقد ہسپتال داخلہ (پیشگی منظوری)', 'Reimbursement of hospital bill': 'ہسپتال بل کی واپسی', 'Hospital / clinic': 'ہسپتال / کلینک',
  'Diagnosis': 'تشخیص', 'ICD-10 code': 'ICD-10 کوڈ', '(from your bill, optional)': '(بل سے، اختیاری)', 'Amount (Rs)': 'رقم (روپے)', 'Nights in hospital': 'ہسپتال میں راتیں',
  'Simple claims are approved in seconds. Others are checked by the insurer — you’ll see why.': 'سادہ کلیم سیکنڈوں میں منظور ہوتے ہیں۔ باقی انشورنس کمپنی چیک کرتی ہے — وجہ آپ کو نظر آئے گی۔',
  'Submit claim': 'کلیم جمع کریں', 'No claims yet.': 'ابھی کوئی کلیم نہیں۔', 'e.g. Dengue fever': 'مثلاً ڈینگی بخار',

  // ── Support ──
  'Programmes': 'پروگرام', 'Am I eligible?': 'کیا میں اہل ہوں؟', 'Where the money goes': 'پیسہ کہاں جاتا ہے', 'Partnership clinics': 'شراکتی کلینک',
  'Financial support for care': 'علاج کے لیے مالی مدد', 'One check matches you to every programme.': 'ایک جانچ سے آپ ہر پروگرام سے مل جاتے ہیں۔',
  'One check, every programme': 'ایک جانچ، ہر پروگرام', 'No forms, no scheme names — one tap.': 'نہ فارم، نہ اسکیموں کے نام — بس ایک ٹیپ۔',
  'We check your CNIC against the national socio-economic registry (NSER) and match you to every programme you qualify for.': 'ہم آپ کا شناختی کارڈ قومی سماجی و معاشی رجسٹری (NSER) سے چیک کر کے ہر اُس پروگرام سے ملاتے ہیں جس کے آپ اہل ہیں۔',
  'We use your CNIC fingerprint and province only. Your CNIC is never stored.': 'ہم صرف شناختی کارڈ کا محفوظ نشان اور صوبہ استعمال کرتے ہیں۔ شناختی کارڈ نمبر محفوظ نہیں ہوتا۔',
  'My support': 'میری مدد', 'Nothing yet — run the check.': 'ابھی کچھ نہیں — جانچ کریں۔', 'Use for medicines': 'دواؤں کے لیے استعمال کریں', 'Poverty score (NSER PMT):': 'غربت اسکور (NSER):',
  'Eligible': 'اہل', 'Not eligible': 'اہل نہیں', 'Donate': 'عطیہ دیں', 'Donate anonymously': 'گمنام عطیہ', 'Pay with': 'ادائیگی بذریعہ',
  'Zakat donations are kept in a separate pool and used only for zakat-eligible patients. Every disbursement appears on the public ledger.': 'زکوٰۃ الگ فنڈ میں رکھی جاتی ہے اور صرف مستحقِ زکوٰۃ مریضوں پر خرچ ہوتی ہے۔ ہر ادائیگی عوامی کھاتے میں نظر آتی ہے۔',
  'Every rupee donated or budgeted, and every rupee spent on care — public, with no personal details.': 'ہر عطیہ اور ہر خرچ شدہ روپیہ — سب کے سامنے، بغیر ذاتی تفصیل کے۔',
  'Received': 'موصول', 'Spent on care': 'علاج پر خرچ', 'Payments to identified patients': 'مریضوں کو ادائیگیاں', 'By programme': 'پروگرام کے لحاظ سے', 'Programme': 'پروگرام',
  'Out': 'خرچ', 'Balance': 'بقایا', 'Spent on': 'کس پر خرچ ہوا', 'Latest transactions': 'تازہ لین دین', 'Partnership clinics & hospitals': 'شراکتی کلینک اور ہسپتال',
  'Monthly scorecards for government facilities run by private partners.': 'نجی شراکت داروں کے زیرِ انتظام سرکاری مراکز کی ماہانہ کارکردگی۔', 'Scorecard': 'کارکردگی',
  'Indicator': 'اشاریہ', 'Target': 'ہدف', 'Actual': 'اصل', 'Achievement': 'کامیابی', 'No reports yet.': 'ابھی کوئی رپورٹ نہیں۔', 'Government': 'سرکاری', 'Zakat': 'زکوٰۃ',
  'Company CSR': 'کمپنی (CSR)', 'Donors': 'عطیہ دہندگان', 'Public-private partnership': 'سرکاری-نجی شراکت',

  // ── Map ──
  'Hospitals, clinics & camps': 'ہسپتال، کلینک اور کیمپ', 'Verified places and free camps near you.': 'آپ کے قریب تصدیق شدہ جگہیں اور مفت کیمپ۔',
  '+ Add a health camp': '+ ہیلتھ کیمپ شامل کریں', '📍 Near me': '📍 میرے قریب', 'More filters': 'مزید فلٹر', 'Female doctor': 'خاتون ڈاکٹر', '24/7 emergency': '24 گھنٹے ایمرجنسی',
  'Service e.g. dialysis, maternity': 'سروس مثلاً ڈائلیسس، زچگی', 'Low-data mode: map tiles are off. Showing a list.': 'کم ڈیٹا موڈ: نقشہ بند ہے۔ فہرست دکھائی جا رہی ہے۔',
  'Directions ↗': 'راستہ ↗', 'Beds free': 'خالی بستر', '✓ Verified': '✓ تصدیق شدہ', 'Unverified': 'غیر تصدیق شدہ', 'OpenStreetMap': 'اوپن اسٹریٹ میپ', '24/7 ER': '24 گھنٹے ایمرجنسی',
  'Happening now': 'ابھی جاری', 'Upcoming': 'آنے والا', 'Hospitals': 'ہسپتال', 'Clinics': 'کلینک', 'BHUs': 'بنیادی مراکزِ صحت', 'RHCs': 'دیہی مراکزِ صحت', 'Labs': 'لیبارٹریاں',
  'Blood banks': 'بلڈ بینک', 'Health camps': 'ہیلتھ کیمپ', 'Add a health camp': 'ہیلتھ کیمپ شامل کریں', 'Camp name': 'کیمپ کا نام', 'Organiser': 'منتظم', 'Starts': 'آغاز', 'Ends': 'اختتام',
  'Services (comma-separated)': 'سروسز (کوما سے الگ)', 'Female doctor available': 'خاتون ڈاکٹر موجود', 'Submit camp': 'کیمپ جمع کریں', 'Free eye camp': 'مفت آئی کیمپ',

  // ── Community ──
  'Ask questions — verified doctors answer.': 'سوال پوچھیں — تصدیق شدہ ڈاکٹر جواب دیتے ہیں۔', '+ New post': '+ نئی پوسٹ', '✓ doctor answered': '✓ ڈاکٹر نے جواب دیا',
  'Open thread →': 'پوری بات دیکھیں ←', 'No posts yet.': 'ابھی کوئی پوسٹ نہیں۔', 'Community rules': 'کمیونٹی کے اصول', '← Community': '→ کمیونٹی',
  'Questions': 'سوالات', 'Blood requests': 'خون کی درخواستیں', 'Health tips': 'صحت کے مشورے', 'Camps & events': 'کیمپ اور تقریبات', 'Announcements': 'اعلانات', 'Stories': 'تجربات',
  'Community answers are not a diagnosis. For emergencies use the Emergency tab or call 1122.': 'کمیونٹی کے جوابات تشخیص نہیں ہیں۔ ایمرجنسی میں ایمرجنسی ٹیب استعمال کریں یا 1122 پر کال کریں۔',
  'Your reply': 'آپ کا جواب', 'Why are you reporting this?': 'آپ یہ رپورٹ کیوں کر رہے ہیں؟', 'Health misinformation': 'صحت سے متعلق غلط معلومات',
  'Shares someone’s private information': 'کسی کی ذاتی معلومات شیئر کرتا ہے', 'Abusive': 'بدسلوکی', 'Spam': 'اسپام', 'New post': 'نئی پوسٹ', 'Health question': 'صحت کا سوال',
  'Blood request (alerts nearby donors)': 'خون کی درخواست (قریبی ڈونرز کو اطلاع)', 'Health tip': 'صحت کا مشورہ', 'My story': 'میرا تجربہ', 'Camp or event': 'کیمپ یا تقریب',
  'Official announcement': 'سرکاری اعلان', 'Don’t share CNIC numbers. Phone numbers are removed automatically except on blood requests.': 'شناختی کارڈ نمبر شیئر نہ کریں۔ فون نمبر خود بخود ہٹا دیے جاتے ہیں سوائے خون کی درخواست کے۔',
  'Blood group needed': 'مطلوبہ بلڈ گروپ', 'Post anonymously (questions and stories)': 'گمنام پوسٹ کریں (سوالات اور تجربات)', '✓ Verified doctor': '✓ تصدیق شدہ ڈاکٹر', 'Official': 'سرکاری',

  // ── Emergency ──
  'Phone calls work even without internet.': 'فون کال انٹرنیٹ کے بغیر بھی ہو جاتی ہے۔', 'Where are you?': 'آپ کہاں ہیں؟', '…or pick a city': '…یا شہر منتخب کریں',
  'You can also tap the map.': 'آپ نقشے پر بھی ٹیپ کر سکتے ہیں۔', 'Add details (optional)': 'تفصیل شامل کریں (اختیاری)', 'Fare support': 'کرایہ میں مدد',
  'No account needed. Fastest ambulance from any service.': 'اکاؤنٹ کی ضرورت نہیں۔ کسی بھی سروس کی سب سے تیز ایمبولینس۔', 'My requests': 'میری درخواستیں',
  'e.g. chest pain, road accident': 'مثلاً سینے میں درد، سڑک حادثہ', 'knows you are coming.': 'کو آپ کے آنے کی اطلاع ہے۔', 'While you wait:': 'انتظار کے دوران:',
  'stay with the patient, keep the airway clear, press firmly on any bleeding, don’t give food or water, and keep your phone free.': 'مریض کے ساتھ رہیں، سانس کا راستہ صاف رکھیں، خون بہنے کی جگہ زور سے دبائیں، کھانا پانی نہ دیں، اور فون مصروف نہ کریں۔',
  'Timeline & fare': 'وقت اور کرایہ', 'Cancel request': 'درخواست منسوخ کریں', 'Getting your location…': 'آپ کی لوکیشن معلوم کی جا رہی ہے…',

  // ── Records ──
  'My record': 'میرا ریکارڈ', 'Add entry': 'اندراج شامل کریں', 'Sharing & consent': 'شیئرنگ اور اجازت', 'Who saw my data': 'میرا ڈیٹا کس نے دیکھا', 'Open a shared record': 'شیئر کیا گیا ریکارڈ کھولیں',
  '⬇ Download': '⬇ ڈاؤن لوڈ', 'Share with a doctor': 'ڈاکٹر کے ساتھ شیئر کریں', 'Share code': 'شیئر کوڈ', 'Allergies:': 'الرجی:', 'Conditions:': 'بیماریاں:', 'No entries yet.': 'ابھی کوئی اندراج نہیں۔',
  'Add to my record': 'میرے ریکارڈ میں شامل کریں', 'Entries you add are marked “self-reported” so doctors know where they came from.': 'آپ کے اندراج "خود درج کردہ" کے طور پر نشان زد ہوتے ہیں تاکہ ڈاکٹر کو ذریعہ معلوم ہو۔',
  'Vitals (BP, sugar, weight)': 'بنیادی معائنہ (بلڈ پریشر، شوگر، وزن)', 'Lab result': 'لیب رزلٹ', 'Allergy': 'الرجی', 'Condition': 'بیماری', 'Vaccination': 'ویکسین', 'Medicine I take': 'دوا جو میں لیتا/لیتی ہوں',
  'Result': 'نتیجہ', 'Unit': 'اکائی', 'Normal range': 'نارمل حد', 'Allergic to': 'کس چیز سے الرجی', 'Reaction': 'ردِعمل', 'Since (year)': 'کب سے (سال)', 'Vaccine': 'ویکسین', 'Dose': 'خوراک',
  'How I take it': 'کیسے لیتا/لیتی ہوں', 'For how long': 'کتنے عرصے کے لیے', 'e.g. Blood pressure': 'مثلاً بلڈ پریشر', 'e.g. Diabetes care': 'مثلاً شوگر کا علاج',
  'Access is time-limited and you can take it back any time. The doctor can read your record and add notes.': 'رسائی محدود وقت کے لیے ہے اور آپ کبھی بھی واپس لے سکتے ہیں۔ ڈاکٹر ریکارڈ پڑھ اور نوٹس لکھ سکتا ہے۔',
  '1 day': '1 دن', '1 week': '1 ہفتہ', '1 month': '1 مہینہ', '6 months': '6 مہینے', '1 year': '1 سال', 'Give access': 'رسائی دیں', '+ Give a doctor access': '+ ڈاکٹر کو رسائی دیں',
  'Who has access now': 'ابھی کس کے پاس رسائی ہے', 'Nobody has access.': 'کسی کے پاس رسائی نہیں۔', 'Past access': 'پچھلی رسائی', 'Active': 'فعال', 'Expired': 'ختم', 'Revoked': 'واپس لی گئی',
  'Other people who saw my data': 'دوسرے لوگ جنہوں نے میرا ڈیٹا دیکھا', 'Nobody but you.': 'آپ کے سوا کسی نے نہیں۔', 'Full activity log': 'مکمل سرگرمی ریکارڈ',
  'Doctors, pharmacists and share-code users. If something looks wrong, revoke access and report it under Privacy.': 'ڈاکٹر، فارماسسٹ اور شیئر کوڈ استعمال کرنے والے۔ کچھ غلط لگے تو رسائی واپس لیں اور رازداری میں رپورٹ کریں۔',
  'For doctors and clinics: enter the code the patient shows you.': 'ڈاکٹروں اور کلینکس کے لیے: مریض کا دکھایا گیا کوڈ لکھیں۔',

  // ── Energy ──
  'Facility power': 'مراکز کی بجلی', 'Solar calculator': 'سولر کیلکولیٹر', 'This app’s footprint': 'اس ایپ کا اثر', 'Clinic & hospital energy': 'کلینک اور ہسپتال کی بجلی',
  'Power and vaccine-fridge status, live.': 'بجلی اور ویکسین فریج کی تازہ صورتحال۔', 'Facilities monitored': 'زیرِ نگرانی مراکز', 'Critical now': 'ابھی سنگین', 'Warnings': 'انتباہ',
  'Facility': 'مرکز', 'Fridge': 'فریج', 'Network totals': 'مجموعی اعداد', 'Grid down now': 'ابھی بجلی بند', 'On solar / hybrid': 'سولر / ہائبرڈ پر', 'Solar capacity': 'سولر صلاحیت',
  'Power OK': 'بجلی ٹھیک', 'Warning': 'انتباہ', 'Critical': 'سنگین', 'No data': 'ڈیٹا نہیں', '← All facilities': '→ تمام مراکز', 'Grid uptime': 'بجلی کی دستیابی', 'Energy from solar': 'سولر سے توانائی',
  'Fridge out of 2–8°C': 'فریج 2–8°C سے باہر', 'Vaccine fridge (°C)': 'ویکسین فریج (°C)', 'All power charts': 'بجلی کے تمام چارٹ', 'Solar for my clinic': 'میرے کلینک کے لیے سولر',
  'Three numbers from your bill give an estimate.': 'بل کے تین اعداد سے اندازہ لگائیں۔', 'Daily electricity use (kWh)': 'روزانہ بجلی کا استعمال (یونٹ)', 'Your monthly bill units ÷ 30': 'ماہانہ بل کے یونٹ ÷ 30',
  'Load-shedding hours/day': 'لوڈ شیڈنگ گھنٹے/دن', 'Critical load during outage (kW)': 'بجلی جانے پر ضروری لوڈ (kW)', 'Fridge, lights, oxygen, fans': 'فریج، روشنی، آکسیجن، پنکھے',
  'Costs & tariffs': 'لاگت اور نرخ', 'Recommended system': 'تجویز کردہ نظام', 'Estimated cost': 'اندازاً لاگت', 'Savings / year': 'سالانہ بچت', 'Payback': 'لاگت کی واپسی', 'System size & notes': 'نظام کا سائز اور نوٹس',

  // ── Privacy ──
  'Your privacy': 'آپ کی رازداری', 'In plain words': 'آسان الفاظ میں', 'Your rights': 'آپ کے حقوق', 'See it': 'دیکھیں', 'Control it': 'کنٹرول کریں', 'Take it': 'لے جائیں',
  'Fix it': 'درست کروائیں', 'Delete it': 'حذف کریں', 'your full record': 'اپنا مکمل ریکارڈ', 'and': 'اور', 'every access to it': 'ہر رسائی', 'give and revoke consent': 'اجازت دیں اور واپس لیں',
  'Make a request': 'درخواست دیں', 'Correct, export or delete': 'درستی، ڈاؤن لوڈ یا حذف', 'Request': 'درخواست', 'Correct my data': 'میرا ڈیٹا درست کریں', 'Full account export': 'پورا اکاؤنٹ ڈاؤن لوڈ',
  'Delete my account': 'میرا اکاؤنٹ حذف کریں', 'Send request': 'درخواست بھیجیں', 'What should be corrected?': 'کیا درست کرنا ہے؟', 'What we keep and why': 'ہم کیا رکھتے ہیں اور کیوں', 'Law & hosting': 'قانون اور ہوسٹنگ',

  // ── My care, family, emergency card, labs, appointments ──
  'Today': 'آج', 'Medicines & reminders': 'دوائیں اور یاد دہانیاں', 'Lab tests': 'لیب ٹیسٹ', 'Appointments': 'ملاقاتیں', 'Family': 'خاندان',
  'My medicines': 'میری دوائیں', 'Emergency card': 'ایمرجنسی کارڈ', '🆘 Emergency card': '🆘 ایمرجنسی کارڈ', 'Appointment': 'ملاقات', 'Check a medicine': 'دوا چیک کریں',
  '✓ Taken': '✓ لے لی', 'Skip': 'چھوڑیں', 'Skipped': 'چھوڑ دی', 'Reorder': 'دوبارہ منگوائیں', 'I’ve refilled': 'میں نے دوبارہ لے لی', 'Refill soon': 'جلد ختم ہوگی',
  'No medicines yet': 'ابھی کوئی دوا نہیں', '+ Add medicine': '+ دوا شامل کریں', '+ Add a medicine': '+ دوا شامل کریں', 'Add reminder': 'یاد دہانی شامل کریں',
  'Turn on alerts': 'الرٹ آن کریں', 'Get a phone alert at dose time while Sehatyab is open.': 'خوراک کے وقت فون پر الرٹ پائیں (جب ایپ کھلی ہو)۔',
  'Progress & settings': 'پیش رفت اور ترتیبات', 'Save times': 'اوقات محفوظ کریں', 'Stop reminders': 'یاد دہانی بند کریں', 'Times': 'اوقات',
  'Once a day (9 am)': 'دن میں ایک بار (صبح 9 بجے)', 'Twice a day (8 am, 8 pm)': 'دن میں دو بار (صبح 8، رات 8)', 'Three times (8, 2, 8)': 'دن میں تین بار (8، 2، 8)', 'At night (9 pm)': 'رات کو (9 بجے)',
  '⏰ Set reminders': '⏰ یاد دہانی لگائیں', '🖨 Print': '🖨 پرنٹ', '🖨 Print / save PDF': '🖨 پرنٹ / PDF محفوظ کریں',
  'My bookings': 'میری بکنگز', '+ Book a test': '+ ٹیسٹ بک کریں', 'Tests': 'ٹیسٹ', 'Lab': 'لیبارٹری', 'Book': 'بک کریں', 'Choose tests': 'ٹیسٹ منتخب کریں',
  'Take the sample at my home (+ Rs 300)': 'نمونہ میرے گھر سے لیں (+ 300 روپے)', 'Address': 'پتہ',
  'Book at a verified lab or get the sample taken at home. Results go straight into your record.': 'تصدیق شدہ لیب میں بک کریں یا گھر سے نمونہ دلوائیں۔ نتائج سیدھے آپ کے ریکارڈ میں آتے ہیں۔',
  'Ask a hospital, clinic or doctor to call you back with a time.': 'ہسپتال، کلینک یا ڈاکٹر سے کہیں کہ وقت بتانے کے لیے آپ کو کال کریں۔',
  '+ Request a call back': '+ کال بیک کی درخواست', 'With': 'کس سے', 'What is it about?': 'کس بارے میں ہے؟', 'Best time to call': 'کال کا بہتر وقت',
  'Morning': 'صبح', 'Afternoon': 'دوپہر', 'Evening': 'شام', 'Female doctor only': 'صرف خاتون ڈاکٹر', 'Doctors': 'ڈاکٹرز', 'Hospitals & clinics': 'ہسپتال اور کلینک',
  'Manage records, medicines and appointments for your children and parents from one phone.': 'اپنے بچوں اور والدین کے ریکارڈ، دوائیں اور ملاقاتیں ایک ہی فون سے سنبھالیں۔',
  'You': 'آپ', 'Manage': 'سنبھالیں', 'Switch to me': 'میری پروفائل پر واپس', '+ Add a family member': '+ خاندان کا فرد شامل کریں', 'Add': 'شامل کریں', 'Relation': 'رشتہ',
  'Grandparent': 'دادا/نانا', 'Sibling': 'بہن/بھائی', '← My care': '→ میری دیکھ بھال', 'Edit contact & details': 'رابطہ اور تفصیل تبدیل کریں',
  'Keep on this phone for emergencies': 'ایمرجنسی کے لیے اس فون پر محفوظ رکھیں', 'Show my emergency card to the crew': 'عملے کو میرا ایمرجنسی کارڈ دکھائیں',
  '🆘 Show my emergency card to the crew': '🆘 عملے کو میرا ایمرجنسی کارڈ دکھائیں', 'Compare prices': 'قیمتوں کا موازنہ', 'Cheapest': 'سب سے سستی',
  '📷 Scan with camera': '📷 کیمرے سے اسکین کریں', '…or type the code': '…یا کوڈ لکھیں', 'Close': 'بند کریں', 'Point at the small square code on the pack': 'پیک پر چھوٹے چوکور کوڈ کی طرف کیمرہ کریں',
  'Speak instead of typing': 'لکھنے کے بجائے بولیں', 'Read this page aloud': 'یہ صفحہ پڑھ کر سنائیں', 'Read aloud': 'پڑھ کر سنائیں',
  // Health map
  'Disease': 'بیماری', 'Access to care': 'علاج تک رسائی', 'Medicine supply': 'دواؤں کی فراہمی', 'Disease map': 'بیماریوں کا نقشہ',
  'Weekly cases reported by facilities, by city.': 'مراکزِ صحت کی ہفتہ وار رپورٹ کردہ کیسز، شہر کے لحاظ سے۔', 'Health map': 'صحت کا نقشہ', '📊 Health map': '📊 صحت کا نقشہ',
  'This week': 'اس ہفتے', '8 weeks': '8 ہفتے', 'Trend': 'رجحان', 'Rising': 'بڑھ رہا ہے', 'Watch': 'نظر رکھیں', 'Normal': 'معمول',
  'How this map works': 'یہ نقشہ کیسے کام کرتا ہے', 'Hospitals mapped': 'نقشے پر ہسپتال', 'Facilities mapped': 'نقشے پر مراکز', 'Cities with a gap': 'کمی والے شہر',
  'How far people are from a hospital, emergency room, lab and blood bank.': 'لوگ ہسپتال، ایمرجنسی، لیب اور بلڈ بینک سے کتنی دور ہیں۔', 'By city': 'شہر کے لحاظ سے',
  'Covered': 'سہولت موجود', '24/7 ER only': 'صرف 24 گھنٹے ایمرجنسی', 'Verified only': 'صرف تصدیق شدہ', 'Essential medicines available': 'ضروری دوائیں دستیاب',
  'Essential medicines in stock at licensed pharmacies, by city.': 'لائسنس یافتہ فارمیسیوں میں ضروری دواؤں کا ذخیرہ، شہر کے لحاظ سے۔',
  '📊 Weekly disease report': '📊 ہفتہ وار بیماری رپورٹ', 'Submit report': 'رپورٹ جمع کریں', 'Disease, access & medicines': 'بیماری، رسائی اور دوائیں',
  // Account & this phone
  'Care preferences': 'دیکھ بھال کی ترجیحات', 'Emergency contact name': 'ایمرجنسی رابطے کا نام', 'Emergency contact mobile': 'ایمرجنسی رابطے کا موبائل',
  'Tell me about free health camps in my city': 'میرے شہر میں مفت ہیلتھ کیمپ کی اطلاع دیں', 'Last blood donation': 'آخری بار خون کا عطیہ',
  'On this phone': 'اس فون پر', 'These settings stay on this device only.': 'یہ ترتیبات صرف اس فون پر رہتی ہیں۔', 'Set PIN': 'پن لگائیں', 'Show': 'دکھائیں',
  'Unlock': 'کھولیں', 'Enter your PIN': 'اپنا پن لکھیں', 'Forgot PIN? Sign out': 'پن بھول گئے؟ سائن آؤٹ کریں', 'Next': 'اگلا', 'Get started': 'شروع کریں',
  'Your data stays yours': 'آپ کا ڈیٹا آپ کا ہی رہتا ہے', 'Back to your own profile': 'آپ کی اپنی پروفائل پر واپس',

  // ── Staff (headings, buttons) ──
  'Patients who gave me access': 'مریض جنہوں نے مجھے رسائی دی', 'Write an e-prescription': 'ای-نسخہ لکھیں', 'Patient mobile': 'مریض کا موبائل', 'More medicines & notes': 'مزید دوائیں اور نوٹس',
  'Send to patient': 'مریض کو بھیجیں', 'Prescriptions I wrote': 'میرے لکھے نسخے', 'Open record': 'ریکارڈ کھولیں', '← My patients': '→ میرے مریض', 'Add clinical entry': 'طبی اندراج شامل کریں',
  'Visit note': 'معائنے کا نوٹ', 'Vitals': 'بنیادی معائنہ', 'Medication': 'دوا', 'Details / notes': 'تفصیل / نوٹس', 'Save to record': 'ریکارڈ میں محفوظ کریں', 'Pharmacy desk': 'فارمیسی ڈیسک',
  'View prescription': 'نسخہ دیکھیں', 'Scan & dispense': 'اسکین کر کے دوا دیں', 'Mark delivered': 'پہنچ گیا', 'No open orders.': 'کوئی زیرِ التوا آرڈر نہیں۔', 'Completed orders': 'مکمل آرڈر',
  'Confirm dispense': 'دوا دینے کی تصدیق', 'Claims desk': 'کلیم ڈیسک', 'Waiting for review': 'جانچ کے منتظر', 'Loss ratio': 'نقصان کا تناسب', 'Review queue': 'جانچ کی قطار', 'Queue is empty.': 'قطار خالی ہے۔',
  'All claims': 'تمام کلیم', 'Portfolio numbers': 'مجموعی اعداد', 'Dispatch board': 'ڈسپیچ بورڈ', 'Active calls': 'جاری کالز', 'Vehicles available': 'دستیاب گاڑیاں', 'Calls today': 'آج کی کالز',
  'Next stage →': 'اگلا مرحلہ ←', 'Fleet': 'گاڑیاں', 'Vehicle': 'گاڑی', 'Provider': 'سروس', 'Incoming alerts': 'آنے والی اطلاعات', 'Bed availability': 'بستروں کی دستیابی', 'Report power status': 'بجلی کی صورتحال بتائیں',
  'Grid electricity on': 'واپڈا بجلی موجود', 'Generator running': 'جنریٹر چل رہا ہے', 'Submit reading': 'ریڈنگ جمع کریں', 'Submit report': 'رپورٹ جمع کریں', 'Overview': 'جائزہ', 'Verification': 'تصدیق',
  'Moderation': 'نگرانی', 'Audit log': 'آڈٹ لاگ', 'Privacy & breaches': 'رازداری اور خلاف ورزیاں', 'Staff': 'عملہ', 'Create staff account': 'عملے کا اکاؤنٹ بنائیں', 'Role': 'کردار',
};

// Phrases containing numbers/names: [regex, replacement]
const R = [
  [/^Covers up to (Rs [\d,]+) a year$/, 'سالانہ $1 تک کوریج'],
  [/^Pays (Rs [\d,]+) per hospital night$/, 'ہسپتال کی ہر رات $1'],
  [/^(\d+) replies$/, '$1 جوابات'],
  [/^(\d+)\+? places( nearest to you)? · verified first\.$/, '$1 جگہیں — تصدیق شدہ پہلے'],
  [/^Covers (.+) · free$/, '$1 کی کوریج · مفت'],
  [/^Run by (.+)$/, 'زیرِ انتظام: $1'],
  [/^(\d+) pharmacies$/, '$1 فارمیسیاں'],
  [/^(\d+) new updates?$/, '$1 نئی اطلاعات'],
];

const ATTRS = ['placeholder', 'aria-label', 'title'];
function tr(s) {
  const k = s.trim();
  if (!k) return null;
  if (P[k]) return s.replace(k, P[k]);
  for (const [re, rep] of R) if (re.test(k)) return s.replace(k, k.replace(re, rep));
  return null;
}
function walk(root) {
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = root; n; n = it.nextNode()) {
    if (n.nodeType === 3) {
      const p = n.parentNode?.nodeName;
      if (p === 'SCRIPT' || p === 'STYLE' || p === 'TEXTAREA') continue;
      const v = tr(n.nodeValue); if (v) n.nodeValue = v;
    } else if (n.nodeType === 1) {
      if (n.hasAttribute('data-no-tr')) continue;
      for (const a of ATTRS) { const v = n.getAttribute(a); if (v) { const t = tr(v); if (t) n.setAttribute(a, t); } }
    }
  }
}

let obs = null;
export function enable() {
  if (obs) return;
  walk(document.body);
  // Batch per animation frame: one pass per render, not one per node (keeps CPU low).
  let queued = new Set(), frame = 0;
  obs = new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) queued.add(n.nodeType === 3 ? n.parentNode : n);
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; const q = queued; queued = new Set(); for (const n of q) if (n?.isConnected) walk(n); });
  });
  obs.observe(document.body, { childList: true, subtree: true });
}
export function disable() { obs?.disconnect(); obs = null; }
