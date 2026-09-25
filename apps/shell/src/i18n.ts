export type Lang = "en" | "ar";

const STRINGS = {
  en: {
    signIn: "Sign in",
    welcome: "Welcome",
    username: "Username, phone or email",
    password: "Password or PIN",
    start: "Start playing",
    noAccount: "No account or no time left? Ask at the counter — we can start a guest session for you.",
    help: "Call staff",
    helpSent: "Staff have been notified",
    offline: "Reconnecting to the venue…",
    timeLeft: "Time left",
    openSession: "Pay at the end",
    logout: "Log out",
    logoutConfirm: "Log out now? Unused prepaid time goes back to your account.",
    minutesLeft: (m: number) => (m === 1 ? "1 minute left — save your game!" : `${m} minutes left`),
    timesUp: "Time's up — thanks for playing!",
    finishing: "Wrapping up your session…",
    signingIn: "Signing in…",
    station: "Station",
  },
  ar: {
    signIn: "تسجيل الدخول",
    welcome: "أهلاً",
    username: "اسم المستخدم أو الهاتف أو البريد",
    password: "كلمة المرور أو الرمز",
    start: "ابدأ اللعب",
    noAccount: "ليس لديك حساب أو انتهى وقتك؟ اسأل الموظف — يمكننا بدء جلسة ضيف لك.",
    help: "اطلب المساعدة",
    helpSent: "تم إبلاغ الموظفين",
    offline: "جارٍ إعادة الاتصال…",
    timeLeft: "الوقت المتبقي",
    openSession: "الدفع عند الانتهاء",
    logout: "تسجيل الخروج",
    logoutConfirm: "تسجيل الخروج الآن؟ يعود الوقت غير المستخدم إلى حسابك.",
    minutesLeft: (m: number) => (m === 1 ? "دقيقة واحدة متبقية — احفظ لعبتك!" : `${m} دقائق متبقية`),
    timesUp: "انتهى الوقت — شكراً للعب!",
    finishing: "جارٍ إنهاء الجلسة…",
    signingIn: "جارٍ تسجيل الدخول…",
    station: "الجهاز",
  },
} as const;

export type Strings = (typeof STRINGS)["en"];
export const strings = (lang: Lang): Strings => STRINGS[lang] as unknown as Strings;
