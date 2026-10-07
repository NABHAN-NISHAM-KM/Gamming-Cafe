"use client";

import { useSyncExternalStore } from "react";

/**
 * English / Arabic for the everyday counter screens (menu, Counter, Live Floor,
 * starting a session, clock-in, handover, switch staff). Setup and finance pages
 * stay in English for now. The choice is kept in this browser.
 * ponytail: one flat dictionary; split per page if it grows past a few hundred keys.
 */
export type Lang = "en" | "ar";
const KEY = "arena.lang";

const EN = {
  // menu
  "nav.Front desk": "Front desk", "nav.Sales & food": "Sales & food", "nav.Gaming floor": "Gaming floor", "nav.Stock": "Stock", "nav.Team": "Team", "nav.Money & insight": "Money & insight", "nav.Setup": "Setup", "nav.Operate": "Operate", "nav.Gaming": "Gaming", "nav.Food & sales": "Food & sales", "nav.Business": "Business",
  "nav.Counter": "Counter", "nav.Dashboard": "Dashboard", "nav.Live Floor": "Live Floor", "nav.Sessions": "Sessions", "nav.Bookings": "Bookings",
  "nav.Customers": "Customers", "nav.Printing": "Printing", "nav.Games": "Games", "nav.Computers": "Computers", "nav.Consoles & VR": "Consoles & VR",
  "nav.Tournaments": "Tournaments", "nav.Restaurant": "Restaurant", "nav.POS": "POS", "nav.Orders": "Orders", "nav.Kitchen": "Kitchen",
  "nav.Inventory": "Inventory", "nav.Purchasing": "Purchasing", "nav.Branches & zones": "Branches & zones", "nav.Employees": "Employees",
  "nav.Roles": "Roles", "nav.Rates": "Rates", "nav.Finance": "Finance", "nav.Reports": "Reports", "nav.Marketing": "Marketing", "nav.Settings": "Settings",
  "nav.Waitlist": "Waitlist", "nav.Gift cards": "Gift cards", "nav.Webhooks": "Webhooks", "nav.Rota": "Rota", "nav.Insights": "Insights", "nav.Billing": "Billing",
  "nav.more": "Show all menus", "nav.less": "Show fewer menus", "nav.search": "Search",
  // staff bar
  "clock.in": "Clock in", "clock.inDone": "Clocked in — have a good shift.", "clock.out": "Clock out", "clock.since": "On shift since", "clock.worked": "Worked", "clock.done": "Clocked out — see you next shift.",
  "switch.title": "Switch staff", "switch.who": "Who is taking over?", "switch.pin": "Their PIN", "switch.go": "Switch", "switch.none": "No colleagues have a counter PIN yet. Each person can set one in Settings → My counter PIN.",
  "switch.mfa": "This person uses 2-step sign-in — they need to sign in with their password and code.", "switch.bad": "Wrong PIN.",
  "lang": "العربية",
  // counter
  "counter.title": "Counter", "counter.subtitle": "The four things you do most. Pick one.",
  "counter.start": "Start a PC", "counter.start.hint": "Pick a free PC, choose the time, take the money",
  "counter.add": "Add time", "counter.add.hint": "Top up someone who is playing",
  "counter.sell": "Sell a snack", "counter.sell.hint": "Drinks, food, anything from the menu",
  "counter.pay": "Take a payment", "counter.pay.hint": "Settle an unpaid bill",
  "board.ending": "Ending in the next 10 minutes", "board.ending.none": "Nobody's time runs out in the next 10 minutes.",
  "board.food": "Food orders waiting", "board.food.none": "No food orders waiting.",
  "board.attention": "Needs attention", "board.attention.none": "Nothing needs attention right now.",
  "board.notes": "Handover notes", "board.notes.hint": "For the next shift: broken gear, who owes what, anything to remember.",
  "board.notes.add": "Add note", "board.notes.placeholder": "e.g. PC-07 mouse is broken · Ali owes 20 for drinks", "board.notes.none": "No open notes.", "board.notes.done": "Done",
  "board.lowstock": "Running low", "board.lowstock.none": "Stock is fine.",
  "board.left": "left", "board.at": "at", "board.addtime": "Add time",
  // floor
  "floor.title": "Live Floor", "floor.all": "All", "floor.attention": "Needs attention", "floor.legend": "What do the colours mean?",
  "floor.outOfOrder": "Out of order", "floor.backInService": "Back in service", "floor.outReason": "What's wrong with it?", "floor.outReason.ph": "e.g. Mouse broken, no sound, controller drift",
  "floor.outNote": "Nobody can start a session here until it's back in service. A note goes on the handover for the next shift.",
  "status.AVAILABLE": "Free", "status.OCCUPIED": "In use", "status.RESERVED": "Booked", "status.SESSION_ENDING": "Ending soon", "status.OFFLINE": "Switched off",
  "status.MAINTENANCE": "Out of order", "status.CLEANING": "Needs cleaning", "status.STARTING": "Starting",
  "help.AVAILABLE": "Free — you can start a session on it.",
  "help.OCCUPIED": "Someone is playing. Click it to add time, move them or end the session.",
  "help.RESERVED": "Booked for a customer who hasn't arrived yet. Start their session when they come.",
  "help.SESSION_ENDING": "Less than 5 minutes left. Ask if they want more time.",
  "help.OFFLINE": "The PC is off or not connected. Switch it on (or Wake it from the station panel).",
  "help.MAINTENANCE": "Marked out of order — nobody can play on it until it's put back in service.",
  "help.CLEANING": "Wipe the headset and controllers, then press \"Mark cleaned\".",
  "help.STARTING": "The PC is getting ready for the player.",
  // start form
  "start.customer": "Customer", "start.customer.ph": "Phone, name or username — or leave empty for a walk-in", "start.time": "How long?",
  "start.more": "More options", "start.less": "Fewer options", "start.rate": "Rate", "start.payment": "How do they pay?", "start.cash": "Cash", "start.card": "Card",
  "start.saved": "Saved hours", "start.payEnd": "Pay at the end", "start.promo": "Promo code (optional)", "start.players": "Players",
  "start.go": "Start", "start.offline": "This PC is switched off — turn it on first.", "start.walkin": "Walk-in",
  // money words
  "word.notPaid": "Not paid yet", "word.salesToday": "Receipts today",
} as const;

export type TKey = keyof typeof EN;

const AR: Partial<Record<TKey, string>> = {
  "nav.Front desk": "مكتب الاستقبال", "nav.Sales & food": "المبيعات والطعام", "nav.Gaming floor": "قاعة الألعاب", "nav.Stock": "المخزون", "nav.Team": "الفريق", "nav.Money & insight": "المال والتحليلات", "nav.Setup": "الإعداد", "nav.Operate": "التشغيل", "nav.Gaming": "الألعاب", "nav.Food & sales": "الطعام والمبيعات", "nav.Business": "الإدارة",
  "nav.Counter": "الكاونتر", "nav.Dashboard": "لوحة التحكم", "nav.Live Floor": "الصالة المباشرة", "nav.Sessions": "الجلسات", "nav.Bookings": "الحجوزات",
  "nav.Customers": "العملاء", "nav.Printing": "الطباعة", "nav.Games": "الألعاب", "nav.Computers": "الأجهزة", "nav.Consoles & VR": "الكونسول والواقع الافتراضي",
  "nav.Tournaments": "البطولات", "nav.Restaurant": "المطعم", "nav.POS": "نقطة البيع", "nav.Orders": "الطلبات", "nav.Kitchen": "المطبخ",
  "nav.Inventory": "المخزون", "nav.Purchasing": "المشتريات", "nav.Branches & zones": "الفروع والمناطق", "nav.Employees": "الموظفون",
  "nav.Roles": "الأدوار", "nav.Rates": "الأسعار", "nav.Finance": "المالية", "nav.Reports": "التقارير", "nav.Marketing": "التسويق", "nav.Settings": "الإعدادات",
  "nav.Waitlist": "قائمة الانتظار", "nav.Gift cards": "بطاقات الهدايا", "nav.Webhooks": "الويب هوك", "nav.Rota": "جدول المناوبات", "nav.Insights": "رؤى", "nav.Billing": "الفوترة",
  "nav.more": "عرض كل القوائم", "nav.less": "عرض قوائم أقل", "nav.search": "بحث",
  "clock.in": "تسجيل الحضور", "clock.inDone": "تم تسجيل الحضور — دوام موفق.", "clock.out": "تسجيل الانصراف", "clock.since": "في الدوام منذ", "clock.worked": "مدة العمل", "clock.done": "تم تسجيل الانصراف — نراك في الدوام القادم.",
  "switch.title": "تبديل الموظف", "switch.who": "من سيستلم؟", "switch.pin": "الرمز السري", "switch.go": "تبديل", "switch.none": "لا يوجد زملاء لديهم رمز للكاونتر بعد. يمكن لكل شخص تعيينه من الإعدادات ← رمز الكاونتر.",
  "switch.mfa": "هذا الشخص يستخدم التحقق بخطوتين — يجب أن يسجل الدخول بكلمة المرور والرمز.", "switch.bad": "رمز خاطئ.",
  "lang": "English",
  "counter.title": "الكاونتر", "counter.subtitle": "أكثر أربعة أشياء تقوم بها. اختر واحداً.",
  "counter.start": "تشغيل جهاز", "counter.start.hint": "اختر جهازاً متاحاً، حدد الوقت، واستلم المبلغ",
  "counter.add": "إضافة وقت", "counter.add.hint": "إضافة وقت لشخص يلعب الآن",
  "counter.sell": "بيع وجبة خفيفة", "counter.sell.hint": "مشروبات وطعام وأي شيء من القائمة",
  "counter.pay": "استلام دفعة", "counter.pay.hint": "تسوية فاتورة غير مدفوعة",
  "board.ending": "ينتهي خلال 10 دقائق", "board.ending.none": "لا ينتهي وقت أحد خلال 10 دقائق.",
  "board.food": "طلبات طعام بالانتظار", "board.food.none": "لا توجد طلبات بالانتظار.",
  "board.attention": "يحتاج إلى انتباه", "board.attention.none": "لا شيء يحتاج إلى انتباه الآن.",
  "board.notes": "ملاحظات التسليم", "board.notes.hint": "للدوام القادم: أجهزة معطلة، من عليه مبلغ، أي شيء يجب تذكره.",
  "board.notes.add": "إضافة ملاحظة", "board.notes.placeholder": "مثال: فأرة PC-07 معطلة · علي عليه 20 للمشروبات", "board.notes.none": "لا توجد ملاحظات مفتوحة.", "board.notes.done": "تم",
  "board.lowstock": "مخزون منخفض", "board.lowstock.none": "المخزون جيد.",
  "board.left": "متبقي", "board.at": "على", "board.addtime": "إضافة وقت",
  "floor.title": "الصالة المباشرة", "floor.all": "الكل", "floor.attention": "يحتاج إلى انتباه", "floor.legend": "ماذا تعني الألوان؟",
  "floor.outOfOrder": "خارج الخدمة", "floor.backInService": "إعادة للخدمة", "floor.outReason": "ما المشكلة؟", "floor.outReason.ph": "مثال: الفأرة معطلة، لا يوجد صوت",
  "floor.outNote": "لا يمكن بدء جلسة هنا حتى يعود للخدمة. ستُضاف ملاحظة للدوام القادم.",
  "status.AVAILABLE": "متاح", "status.OCCUPIED": "قيد الاستخدام", "status.RESERVED": "محجوز", "status.SESSION_ENDING": "ينتهي قريباً", "status.OFFLINE": "مطفأ",
  "status.MAINTENANCE": "خارج الخدمة", "status.CLEANING": "يحتاج تنظيف", "status.STARTING": "قيد التشغيل",
  "help.AVAILABLE": "متاح — يمكنك بدء جلسة عليه.",
  "help.OCCUPIED": "شخص يلعب الآن. اضغط عليه لإضافة وقت أو نقله أو إنهاء الجلسة.",
  "help.RESERVED": "محجوز لعميل لم يصل بعد. ابدأ جلسته عند وصوله.",
  "help.SESSION_ENDING": "أقل من 5 دقائق متبقية. اسأله إن كان يريد وقتاً إضافياً.",
  "help.OFFLINE": "الجهاز مطفأ أو غير متصل. شغّله (أو أيقظه من لوحة الجهاز).",
  "help.MAINTENANCE": "خارج الخدمة — لا يمكن اللعب عليه حتى يعود للخدمة.",
  "help.CLEANING": "امسح النظارة ووحدات التحكم، ثم اضغط \"تم التنظيف\".",
  "help.STARTING": "الجهاز يستعد للاعب.",
  "start.customer": "العميل", "start.customer.ph": "الهاتف أو الاسم أو اسم المستخدم — أو اتركه فارغاً لزائر", "start.time": "كم المدة؟",
  "start.more": "خيارات أكثر", "start.less": "خيارات أقل", "start.rate": "السعر", "start.payment": "طريقة الدفع", "start.cash": "نقداً", "start.card": "بطاقة",
  "start.saved": "الساعات المحفوظة", "start.payEnd": "الدفع عند الانتهاء", "start.promo": "رمز ترويجي (اختياري)", "start.players": "اللاعبون",
  "start.go": "ابدأ", "start.offline": "هذا الجهاز مطفأ — شغّله أولاً.", "start.walkin": "زائر",
  "word.notPaid": "غير مدفوع بعد", "word.salesToday": "إيصالات اليوم",
};

const listeners = new Set<() => void>();
const read = (): Lang => {
  try {
    return localStorage.getItem(KEY) === "ar" ? "ar" : "en";
  } catch {
    return "en"; // storage unavailable (private mode)
  }
};

export function setLang(l: Lang) {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* ignore */
  }
  applyDir(l);
  listeners.forEach((f) => f());
}

export function applyDir(l: Lang = read()) {
  document.documentElement.lang = l;
  document.documentElement.dir = l === "ar" ? "rtl" : "ltr";
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    read,
    () => "en",
  );
}

/** t("nav.POS") → the label in the chosen language (English when there's no translation). */
export function useT() {
  const lang = useLang();
  return (k: TKey) => (lang === "ar" ? AR[k] : undefined) ?? EN[k];
}
