import {
  ArrowRight,
  BookOpen,
  Headphones,
  Languages,
  Layers,
  LogIn,
  Sparkles,
  Volume2,
} from 'lucide-react';
import { applySmartPartialTashkeel } from '../utils/arabic';

interface LandingPageProps {
  onGetStarted: (mode: 'login' | 'register') => void;
}

const CORE_FEATURES = [
  {
    number: '01.',
    titleAr: 'قراءة ذكية بالتشكيل الجزئي',
    titleEn: 'Smart Partial Tashkeel Reading',
    descriptionAr:
      'تشكيلٌ متوازنٌ يُظهرُ حركاتِ الإعرابِ والشدّةِ والمُدودِ فقط، لتقرأَ النّصوصَ العربيّةَ بسلاسةٍ دونَ إرباكٍ بصريّ.',
    descriptionEn:
      'Vowelizes essential case endings, shaddah, and long vowels so you transition comfortably to real-world Arabic texts.',
    Icon: BookOpen,
    iconTint: 'bg-[#EEF2E9] text-[#2D3B22] border-[#DCE5D3]',
  },
  {
    number: '02.',
    titleAr: 'ترجمة فورية وسياقية بضغطة زر',
    titleEn: 'Instant Contextual Translation',
    descriptionAr:
      'اضغط على أيّ كلمةٍ داخل النّصّ لتظهرَ ترجمتُها الدّقيقةُ حسبَ السّياقِ مع النّطقِ الصّوتيّ وجُملٍ تطبيقيّةٍ واضحة.',
    descriptionEn:
      'Tap or hold any Arabic word while reading to see its contextual English meaning, transliteration, and natural usage examples.',
    Icon: Languages,
    iconTint: 'bg-[#FBF3DC] text-[#9A6F14] border-[#E8B948]/50',
  },
  {
    number: '03.',
    titleAr: 'بطاقات مراجعة ذكية وتكرار متباعد',
    titleEn: 'Smart SRS Flashcards & Games',
    descriptionAr:
      'احفظ الكلماتِ الجديدةَ في بطاقاتٍ تفاعليّةٍ تضمّ نوعَ الكلمةِ والجذرَ، وتدرّب عبرَ اختباراتِ الفهمِ والتّكرارِ المتباعد.',
    descriptionEn:
      'Turn saved words into interactive 3D flashcards with word type, root clues, matching drills, multiple-choice quizzes, and SRS intervals.',
    Icon: Layers,
    iconTint: 'bg-[#EEF2E9] text-[#2D3B22] border-[#DCE5D3]',
  },
  {
    number: '04.',
    titleAr: 'دروس صوتية ومرئية متزامنة',
    titleEn: 'Synchronized Audio & Video Lessons',
    descriptionAr:
      'استمع إلى النّصوصِ بصوتٍ عربيٍّ واضحٍ مع تظليلٍ متزامنٍ للكلمات، وتابِع مقاطعَ الفيديو بالتّزامن مع النّصّ المكتوب.',
    descriptionEn:
      'Follow spoken Arabic word-by-word at 0.75x or 1x speed, or scrub through YouTube video lessons synced directly with readable transcripts.',
    Icon: Headphones,
    iconTint: 'bg-[#FBF3DC] text-[#9A6F14] border-[#E8B948]/50',
  },
] as const;

const STUDY_STEPS = [
  {
    step: '01.',
    titleAr: 'اختر مستواك وابدأ القراءة',
    titleEn: 'Choose Your Level & Read',
    text: 'Select Beginner, Intermediate, or Advanced texts tailored for gradual Arabic mastery.',
  },
  {
    step: '02.',
    titleAr: 'ترجم الكلمات ودوّن ملاحظاتك',
    titleEn: 'Tap Words & Keep Notes',
    text: 'Inspect meanings in context, listen to native pronunciation, and save personal grammar reminders.',
  },
  {
    step: '03.',
    titleAr: 'ثبّت المفردات بالتكرار المتباعد',
    titleEn: 'Review with Flashcards & Quizzes',
    text: 'Reinforce retention through 3D flashcards, word-matching challenges, and comprehension checks.',
  },
] as const;

export function LandingPage({ onGetStarted }: LandingPageProps) {
  const sampleSentence =
    'في الصَّباحِ الباكِرِ، يفتَحُ الباعةُ أبوابَ السّوقِ القَديمِ وتفوحُ رائِحةُ القَهوةِ العَرَبيّةِ.';

  return (
    <div className="flex-1 bg-[#FAFBF8]">
      {/* 1. Rich Dark Olive Gradient Hero Section */}
      <section className="relative overflow-hidden border-b border-[#3E522D] bg-[linear-gradient(135deg,#24301B_0%,#3E522D_100%)] text-[#FAFBF8]">
        <div className="islamic-geo-pattern pointer-events-none absolute inset-0 opacity-45" />
        <div className="pointer-events-none absolute -top-28 -right-24 h-80 w-80 rounded-full bg-[#D4A338]/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 -left-24 h-80 w-80 rounded-full bg-[#DCE5D3]/10 blur-3xl" />

        <div className="relative mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-12 items-stretch">
            {/* Editorial Proposition Column */}
            <div className="lg:col-span-7 flex flex-col justify-center space-y-6 animate-fade-slide-up">
              <div className="space-y-4">
                <p
                  dir="rtl"
                  lang="ar"
                  className="font-arabic-cairo text-sm font-bold text-[#E8B948]"
                >
                  منصّة قَلَم لتعلّم اللّغة العربيّة عبر القراءة السّياقيّة
                </p>

                <h1
                  dir="rtl"
                  lang="ar"
                  className="font-arabic-scheherazade text-4xl sm:text-5xl lg:text-[54px] font-bold text-white leading-[1.45] [text-wrap:balance]"
                >
                  اقرأ العربيّةَ بفهمٍ عميقٍ، واستمع إليها في سياقِها الطّبيعيّ
                </h1>

                <p
                  dir="rtl"
                  lang="ar"
                  className="font-arabic-cairo text-base sm:text-lg text-[#EEF2E9] leading-relaxed max-w-2xl"
                >
                  تساعدك منصّةُ قَلَم على اكتسابِ العربيّةِ بطريقةٍ طبيعيّةٍ عبر نصوصٍ متدرّجةٍ بالتّشكيل الجزئيّ الذّكيّ، وترجمةٍ سياقيّةٍ فوريّةٍ، وبطاقاتِ مراجعةٍ تُرسّخُ المفرداتِ في ذاكرتك.
                </p>

                <p className="text-sm sm:text-base text-[#DCE5D3] leading-relaxed max-w-xl">
                  Build lasting Arabic reading and listening fluency through partial tashkeel texts, one-tap contextual translations, synchronized audio, and smart spaced-repetition practice.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => onGetStarted('register')}
                  className="inline-flex min-h-[48px] items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-[#D4A338] to-[#E8B948] px-6 py-3 text-sm sm:text-base font-bold text-[#1F2718] hover:brightness-105 shadow-md transition-all cursor-pointer touch-manipulation active:scale-[0.98] whitespace-nowrap"
                >
                  <span>ابدأ التعلم الآن / Get Started</span>
                  <ArrowRight className="h-4 w-4 text-[#1F2718]" aria-hidden="true" />
                </button>

                <button
                  type="button"
                  onClick={() => onGetStarted('login')}
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/10 px-5 py-3 text-sm font-semibold text-white hover:bg-white/20 transition-all cursor-pointer touch-manipulation active:scale-[0.98] whitespace-nowrap"
                >
                  <LogIn className="h-4 w-4 text-[#E8B948]" aria-hidden="true" />
                  <span>تسجيل الدخول · Sign In</span>
                </button>
              </div>
            </div>

            {/* Static Product Reading Preview Card (Zero Student Metrics) */}
            <div className="lg:col-span-5 flex flex-col justify-center animate-fade-slide-up animate-delay-150">
              <div className="rounded-2xl border border-[#DCE5D3]/35 bg-[#FAFBF8] p-5 sm:p-6 shadow-2xl space-y-5 text-[#1F2718]">
                <div className="flex items-center justify-between gap-2 border-b border-[#DCE5D3] pb-3 text-xs text-[#5A6552]">
                  <span className="font-semibold text-[#2D3B22]">Interactive Reading Preview</span>
                  <span dir="rtl" lang="ar" className="font-arabic-cairo text-sm font-bold text-[#3B4D2B]">
                    نموذج القراءة الذّكيّة
                  </span>
                </div>

                <div
                  dir="rtl"
                  lang="ar"
                  className="font-arabic-scheherazade text-2xl sm:text-[27px] leading-[2.2] text-[#1F2718] text-right"
                >
                  {applySmartPartialTashkeel(sampleSentence).split('القَهوةِ').map((part, idx, arr) => (
                    <span key={idx}>
                      {part}
                      {idx < arr.length - 1 && (
                        <span className="mx-0.5 inline-block rounded-lg bg-[#FBF3DC] px-2 py-0.5 text-[#2D3B22] ring-2 ring-[#D4A338]/70">
                          القَهوةِ
                        </span>
                      )}
                    </span>
                  ))}
                </div>

                <div className="rounded-xl border border-[#DCE5D3] bg-white p-4 space-y-2.5 shadow-2xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span dir="rtl" lang="ar" className="font-arabic-scheherazade text-2xl font-bold text-[#1F2718]">
                        القَهوةُ
                      </span>
                      <span className="text-xs text-[#6B7861]">·</span>
                      <span className="font-mono text-xs text-[#5A6552]">al-qahwa</span>
                    </div>
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#EEF2E9] text-[#2D3B22] border border-[#DCE5D3]" aria-hidden="true">
                      <Volume2 className="h-3.5 w-3.5" />
                    </span>
                  </div>

                  <p className="text-sm font-bold text-[#2D3B22]">the coffee</p>

                  <div className="flex items-center justify-between gap-2 border-t border-[#EEF2E9] pt-2 text-xs text-[#5A6552]">
                    <span className="font-arabic-cairo">نوع الكلمة: اسم · الجذر: ق - هـ - و</span>
                    <span className="text-[#9A6F14] font-semibold">Contextual lookup</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Core Features Showcase Grid */}
      <section id="features" className="scroll-mt-20 py-14 sm:py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 space-y-8">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between animate-fade-slide-up">
            <div className="space-y-1.5">
              <h2
                dir="rtl"
                lang="ar"
                className="font-arabic-scheherazade text-3xl sm:text-4xl font-bold text-[#2D3B22]"
              >
                مزايا المنصّة الأساسيّة
              </h2>
              <p className="font-display text-xl sm:text-2xl font-bold text-[#1F2718] [text-wrap:balance]">
                Focused tools built for comprehension and long-term retention
              </p>
            </div>
            <p className="text-xs sm:text-sm text-[#5A6552] max-w-md">
              Everything works together in one calm Arabic reading workspace—from vowelized text to spaced repetition.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {CORE_FEATURES.map((feature, idx) => {
              const IconComponent = feature.Icon;
              return (
                <article
                  key={feature.number}
                  className={`animate-fade-slide-up rounded-2xl border border-[#DCE5D3] bg-white p-6 sm:p-7 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-[#3E522D]/50 hover:shadow-md flex flex-col justify-between gap-4 ${
                    idx % 2 === 1 ? 'animate-delay-75' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${feature.iconTint}`}
                    >
                      <IconComponent className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <span className="font-mono text-xs font-semibold text-[#6B7861] tabular-nums">
                      {feature.number}
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    <h3
                      dir="rtl"
                      lang="ar"
                      className="font-arabic-scheherazade text-2xl sm:text-[26px] font-bold text-[#1F2718] text-right leading-snug"
                    >
                      {feature.titleAr}
                    </h3>
                    <h4 className="font-display text-base font-bold text-[#2D3B22]">
                      {feature.titleEn}
                    </h4>
                    <p
                      dir="rtl"
                      lang="ar"
                      className="font-arabic-cairo text-sm text-[#3F4A37] leading-relaxed text-right"
                    >
                      {feature.descriptionAr}
                    </p>
                    <p className="text-xs sm:text-sm text-[#5A6552] leading-relaxed">
                      {feature.descriptionEn}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* 3. Clear 3-Step Learning Flow */}
      <section id="how-it-works" className="scroll-mt-20 border-y border-[#DCE5D3] bg-[#EEF2E9]/55 py-12 sm:py-14">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 space-y-7">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-display text-xl sm:text-2xl font-bold text-[#1F2718]">
              How Your Study Flow Works
            </h2>
            <span
              dir="rtl"
              lang="ar"
              className="font-arabic-scheherazade text-2xl font-bold text-[#2D3B22]"
            >
              كيف تبدأ رحلتك في قَلَم؟
            </span>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {STUDY_STEPS.map((item) => (
              <div
                key={item.step}
                className="rounded-2xl border border-[#DCE5D3] bg-white p-5 space-y-2 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
              >
                <span className="inline-flex items-center justify-center rounded-lg bg-[#FBF3DC] px-2.5 py-0.5 font-mono text-xs font-bold text-[#9A6F14] tabular-nums">
                  {item.step}
                </span>
                <h3
                  dir="rtl"
                  lang="ar"
                  className="font-arabic-scheherazade text-xl font-bold text-[#2D3B22] text-right"
                >
                  {item.titleAr}
                </h3>
                <h4 className="font-display text-sm font-bold text-[#1F2718]">
                  {item.titleEn}
                </h4>
                <p className="text-xs sm:text-sm text-[#5A6552] leading-relaxed">
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4. Final Call-to-Action (CTA) */}
      <section className="py-12 sm:py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#24301B_0%,#3E522D_100%)] px-6 py-10 sm:px-12 sm:py-14 text-white shadow-lg">
            <div className="islamic-geo-pattern pointer-events-none absolute inset-0 opacity-40" />

            <div className="relative mx-auto max-w-3xl text-center space-y-5">
              <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#E8B948]">
                <Sparkles className="h-4 w-4 text-[#E8B948]" aria-hidden="true" />
                <span className="font-arabic-cairo">Free Personal Account · حساب مجاني بالكامل</span>
              </div>

              <h2
                dir="rtl"
                lang="ar"
                className="font-arabic-scheherazade text-3xl sm:text-5xl font-bold text-white leading-[1.5] [text-wrap:balance]"
              >
                أنشئ حسابك المجاني واختر مستواك الآن
              </h2>

              <p className="mx-auto max-w-xl text-sm sm:text-base text-[#DCE5D3] leading-relaxed">
                Sign up in seconds to unlock Beginner, Intermediate, and Advanced Arabic lessons, build your personal SRS flashcard deck, and keep study notes across every session.
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => onGetStarted('register')}
                  className="inline-flex min-h-[48px] w-full sm:w-auto items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-[#D4A338] to-[#E8B948] px-7 py-3 text-sm sm:text-base font-bold text-[#1F2718] hover:brightness-105 shadow-md transition-all cursor-pointer touch-manipulation active:scale-[0.98] whitespace-nowrap"
                >
                  <span>ابدأ التعلم الآن / Get Started</span>
                  <ArrowRight className="h-4 w-4 text-[#1F2718]" aria-hidden="true" />
                </button>

                <button
                  type="button"
                  onClick={() => onGetStarted('login')}
                  className="inline-flex min-h-[48px] w-full sm:w-auto items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/10 px-6 py-3 text-sm font-semibold text-white hover:bg-white/20 transition-all cursor-pointer touch-manipulation active:scale-[0.98] whitespace-nowrap"
                >
                  <LogIn className="h-4 w-4 text-[#E8B948]" aria-hidden="true" />
                  <span>Already have an account? Sign In</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
