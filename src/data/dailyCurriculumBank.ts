import type { Lesson, ProficiencyLevel } from '../types/arabic';
import { applySmartPartialTashkeel, countArabicWords, stripTashkeel } from '../utils/arabic';

export interface CurriculumLessonSeed {
  level: ProficiencyLevel;
  topicKey: string;
  titleAr: string;
  titleEn: string;
  description: string;
  textAr: string;
}

export const DAILY_CURRICULUM_QUOTA_PER_LEVEL = 4;
export const CURRICULUM_LEVELS: ProficiencyLevel[] = ['beginner', 'intermediate', 'advanced'];

export function normalizeCurriculumTopicKey(input: string): string {
  return stripTashkeel(input || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, '-')
    .trim();
}

export function buildExistingTopicSet(existingTopics: string[] = []): Set<string> {
  const set = new Set<string>();
  for (const raw of existingTopics) {
    const slug = normalizeCurriculumTopicKey(raw);
    if (slug) set.add(slug);
  }
  return set;
}

export function isTopicDuplicate(
  candidate: { topicKey?: string; titleAr?: string; titleEn?: string },
  seenTopics: Set<string>
): boolean {
  const keys = [candidate.topicKey, candidate.titleAr, candidate.titleEn]
    .map((v) => normalizeCurriculumTopicKey(v || ''))
    .filter(Boolean);
  return keys.some((k) => seenTopics.has(k));
}

export function registerSeenTopic(
  candidate: { topicKey?: string; titleAr?: string; titleEn?: string },
  seenTopics: Set<string>
): void {
  for (const raw of [candidate.topicKey, candidate.titleAr, candidate.titleEn]) {
    const slug = normalizeCurriculumTopicKey(raw || '');
    if (slug) seenTopics.add(slug);
  }
}

export function buildDailyCurriculumPrompt(
  dateKey: string,
  missingCounts: Record<ProficiencyLevel, number>,
  existingTopics: string[]
): string {
  const avoidList = existingTopics
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 60)
    .join(' | ');

  return `You are an expert Arabic language curriculum designer for Qalam (قَلَم).
Today's curriculum date: ${dateKey}.
Generate a curated set of fresh Modern Standard Arabic (الفصحى) reading lessons as JSON.

REQUIRED COUNTS PER LEVEL (generate EXACTLY these counts):
- beginner (مبتدئ): ${missingCounts.beginner} lesson(s)
  * Length: 55–85 Arabic words each across 2 short paragraphs.
  * Vocabulary & grammar: Everyday life, nature, weather, bakery, library, train ride, hobbies, seasons. Short clear sentences.
- intermediate (متوسط): ${missingCounts.intermediate} lesson(s)
  * Length: 95–140 Arabic words each across 2–3 paragraphs.
  * Vocabulary & grammar: Culture, journalism, science history, craftsmanship, urban planning, sustainability, education, travel journals.
- advanced (متقدم): ${missingCounts.advanced} lesson(s)
  * Length: 140–210 Arabic words each across 2–3 rich paragraphs.
  * Vocabulary & grammar: Philosophy, classical heritage, rhetoric, literature, linguistics, ecology, ethics, architectural aesthetics.

STRICT RULES:
1. Every lesson MUST have a distinct topic and title. NEVER repeat or closely paraphrase any of these existing topics/titles:
${avoidList || '(none yet)'}
2. Write natural, engaging Arabic with clear vocalization (tashkeel) on key endings and ambiguous letters.
3. Return ONLY valid JSON (no markdown fences) matching this exact schema:
{
  "lessons": [
    {
      "level": "beginner" | "intermediate" | "advanced",
      "topicKey": "short-kebab-case-topic-slug",
      "titleAr": "Arabic title",
      "titleEn": "English title",
      "description": "1 concise English sentence summarizing grammar/vocabulary focus.",
      "textAr": "Full Arabic reading passage separated by a blank line between paragraphs."
    }
  ]
}`;
}

export const CURATED_CURRICULUM_BANK: CurriculumLessonSeed[] = [
  // BEGINNER
  {
    level: 'beginner',
    topicKey: 'morning-bakery-bread',
    titleAr: 'رائحةُ الخُبْزِ الطّازجِ',
    titleEn: 'The Aroma of Fresh Bread',
    description:
      'Practice morning verbs, bakery vocabulary, polite requests, and everyday adjectives.',
    textAr: `يذهبُ سامي كلَّ صباحٍ إلى المَخْبَزِ القريبِ مِنْ بيْتِهِ. يَشُمُّ رائحةَ الخُبْزِ السّاخنِ مِنْ بعيدٍ، فيبتسمُ ويَدْخُلُ بسُرعةٍ.

يُحيّي الخَبّازَ بابتسامةٍ ويقولُ: «صباحُ الخيْرِ، أريدُ رغيفَيْنِ مِنْ خبزِ القمحِ وبعضَ الكعكِ». يشكرُ سامي البائعَ ويعودُ إلى البيتِ لِيتناولَ الفطورَ معَ أُسرتِهِ.`,
  },
  {
    level: 'beginner',
    topicKey: 'rainy-afternoon-window',
    titleAr: 'مطرٌ خفيفٌ بعدَ الظّهرِ',
    titleEn: 'A Gentle Afternoon Rain',
    description:
      'Learn weather expressions, indoor comfort nouns, and present-tense feelings in simple sentences.',
    textAr: `تَتَجمَّعُ الغُيومُ الرّماديّةُ في السّماءِ بعدَ الظّهرِ، ثمَّ يبدأُ المَطَرُ الخفيفُ بالتّساقُطِ على الأشجارِ والطّرقاتِ.

تجلسُ ليلى بجانبِ النّافذةِ الكبيرةِ وتشربُ كوبًا مِنَ الحليبِ الدّافئِ. تستمعُ إلى صوتِ القَطَراتِ وتفتحُ كتابًا مُصوَّرًا عنِ الحيواناتِ البريّةِ، وتشعرُ بالرّاحةِ والسّرورِ.`,
  },
  {
    level: 'beginner',
    topicKey: 'neighborhood-public-library',
    titleAr: 'زيارةٌ إلى المكتبةِ العامّةِ',
    titleEn: 'A Visit to the Public Library',
    description:
      'Build vocabulary for books, quiet spaces, days of the week, and basic reading habits.',
    textAr: `في يومِ السّبتِ، يذهبُ عادلٌ وأُختُهُ نورةُ إلى المكتبةِ العامّةِ في وسطِ المدينةِ. القاعةُ هادئةٌ ومنظّمةٌ، وعلى الرّفوفِ مئاتُ الكتبِ الملوّنةِ.

يختارُ عادلٌ كتابًا سهْلًا عنِ الفضاءِ والنّجومِ، بينما تقرأُ نورةُ قصّةً قصيرةً عنْ رحلةٍ بحريّةٍ. يجلسانِ بهدوءٍ ساعةً كاملةً قبلَ العودةِ إلى المنزلِ.`,
  },
  {
    level: 'beginner',
    topicKey: 'spring-train-journey',
    titleAr: 'رحلةٌ قصيرةٌ بالقِطارِ',
    titleEn: 'A Short Train Journey',
    description:
      'Practice travel words, landscape descriptions, colors, and simple past-tense narration.',
    textAr: `ركبَ عمرُ القطارَ في السّاعةِ الثّامنةِ صباحًا لزيارةِ عمّهِ في القريةِ. نظرَ مِنَ النّافذةِ فرأى الحقولَ الخضراءَ والأنهارَ الصّافيةَ.

كانتِ الرّحلةُ مريحةً وسريعةً، وبَعْدَ ساعةٍ وصلَ القطارُ إلى المحطّةِ الصّغيرةِ. استقبلَهُ عمُّهُ بحفاوةٍ وحملَ معهُ الحقيبةَ إلى المزرعةِ.`,
  },
  {
    level: 'beginner',
    topicKey: 'kitchen-weekend-soup',
    titleAr: 'حساءُ الخضارِ الدّافئُ',
    titleEn: 'Warm Vegetable Soup',
    description:
      'Master common kitchen nouns, vegetables, sequencing words, and helpful family verbs.',
    textAr: `تُساعدُ مريمُ والدتَها في المطبخِ مساءَ الجُمعةِ. تغسلُ الجَزَرَ والبطاطا والطّماطمَ بالماءِ الباردِ، ثمَّ تُقطّعُها على اللّوْحِ الخشبيِّ.

تضعُ الأمُّ الخضارَ في القِدْرِ معَ قليلٍ مِنْ زيتِ الزّيتونِ والملحِ. بعدَ نصفِ ساعةٍ، يصبحُ الحساءُ جاهزًا ويجتمعُ الجميعُ حولَ المائدةِ.`,
  },
  {
    level: 'beginner',
    topicKey: 'first-bicycle-ride',
    titleAr: 'درّاجةٌ زرقاءُ جديدةٌ',
    titleEn: 'A New Blue Bicycle',
    description:
      'Practice basic action verbs, outdoor park vocabulary, and encouraging dialogue phrases.',
    textAr: `حصلَ زيادٌ على درّاجةٍ زرقاءَ في عيدِ ميلادِهِ. في الحديقةِ القريبةِ، ارتدى خوذتَهُ وبدأَ يتعلّمُ التّوازنَ بمساعدةِ والدِهِ.

سقطَ مرّةً واحدةً على العُشْبِ اللّيّنِ، لكنّهُ ضحكَ وحاولَ مِنْ جديدٍ. في النّهايةِ، قادَ الدّرّاجةَ وَحْدَهُ ولوَّحَ بيدِهِ فرحًا.`,
  },
  {
    level: 'beginner',
    topicKey: 'friday-fruit-market',
    titleAr: 'جولةٌ في سوقِ الفواكه',
    titleEn: 'A Walk in the Fruit Market',
    description:
      'Practice fruit vocabulary, counting, prices, and polite shopping questions in everyday Arabic.',
    textAr: `في صباحِ الجُمعةِ، يرافقُ طارقٌ جدّتَهُ إلى سوقِ الفواكه القريبِ. يعرضُ الباعةُ التّفّاحَ الأحمرَ والبرتقالَ الحلوَ والتّينَ الطّازجَ في سلالٍ خشبيّةٍ.

تسألُ الجدّةُ عنْ سعرِ العنبِ، فيبتسمُ البائعُ ويُعطيها حزْمةً جميلةً. يضعُ طارقٌ الفواكه في الكيسِ القماشيِّ ويحملُها بسعادةٍ إلى البيتِ.`,
  },
  {
    level: 'beginner',
    topicKey: 'balcony-mint-plant',
    titleAr: 'نبتةُ النّعناعِ على الشّرفةِ',
    titleEn: 'The Mint Plant on the Balcony',
    description:
      'Learn daily routine verbs, plant care words, sun and water expressions, and gentle adjectives.',
    textAr: `تزرعُ هدى نبتةَ نعناعٍ صغيرةً في أصيصٍ فخّاريٍّ على شُرفةِ الغُرفةِ. كلَّ صباحٍ، تفتحُ السّتائرَ وتَسقي الأوراقَ الخضراءَ بقليلٍ مِنَ الماءِ.

تصلُ أشعّةُ الشّمسِ اللّطيفةُ إلى النّبتةِ فتكبرُ يومًا بعدَ يومٍ. وفي المساءِ، تقطفُ هدى ورقتَيْنِ لتُضيفَهما إلى إبريقِ الشّايِ الدّافئِ.`,
  },
  // INTERMEDIATE
  {
    level: 'intermediate',
    topicKey: 'ancient-sundials-and-time',
    titleAr: 'المِزْوَلةُ الشّمسيّةُ وقياسُ الزّمنِ',
    titleEn: 'Sundials and the Measurement of Time',
    description:
      'Explore historical science vocabulary, passive participles, and cause-and-effect connectors.',
    textAr: `قبلَ اختراعِ السّاعاتِ الميكانيكيّةِ الدّقيقةِ، اعتمدَ الإنسانُ على حركةِ الشّمسِ والظّلالِ لمعرفةِ أوقاتِ النّهارِ. وقدْ طوّرَ العلماءُ في الحضاراتِ القديمةِ المِزْوَلةَ الشّمسيّةَ، وهيَ أداةٌ حجريّةٌ أو معدنيّةٌ تُحدّدُ السّاعةَ مِنْ خلالِ موقعِ الظّلِّ وطولِهِ.

في المدنِ العربيّةِ التّاريخيّةِ، كانتِ المزاولُ تُثبَّتُ في السّاحاتِ العامّةِ وعلى جدرانِ المساجدِ، وتُنقَشُ عليْها خطوطٌ هندسيّةٌ دقيقةٌ تراعي فصولَ السّنةِ. لمْ تكنْ هذهِ الأدواتُ مجرّدَ وسائلَ عمليّةٍ، بلْ عكستْ شغفًا عميقًا بعلمِ الفلكِ والهندسةِ.`,
  },
  {
    level: 'intermediate',
    topicKey: 'damascene-wood-inlay',
    titleAr: 'فنُّ التّطعيمِ بالصّدَفِ والخشبِ',
    titleEn: 'The Craft of Mother-of-Pearl Inlay',
    description:
      'Learn artisanal craft terminology, sensory descriptions, and cultural preservation phrasing.',
    textAr: `يُعَدُّ فنُّ التّطعيمِ بالصّدَفِ واحدًا مِنْ أعرقِ الحرفِ اليدويّةِ في بلادِ الشّامِ. يجلسُ الحِرَفيُّ ساعاتٍ طويلةً في ورشتِهِ الصّغيرةِ، ليقطعَ قِطعًا دقيقةً مِنْ خشبِ الجوزِ والمشمشِ واللّيمونِ، ثمَّ يُجمّعُها في أشكالٍ هندسيّةٍ متناسقةٍ.

بعدَ ذلكَ، تُغرَسُ رقائقُ الصّدَفِ البحريِّ اللامعِ في التّجاويفِ المخصَّصةِ لها بدقّةٍ متناهيةٍ. وتحتاجُ هذهِ الصّناعةُ إلى صبرٍ كبيرٍ وخبرةٍ متوارثةٍ عبرَ الأجيالِ؛ إذْ يتحوّلُ الصّندوقُ الخشبيُّ البسيطُ إلى قطعةٍ فنّيّةٍ تروي حكايةَ الذّوْقِ والتّراثِ.`,
  },
  {
    level: 'intermediate',
    topicKey: 'urban-rooftop-gardens',
    titleAr: 'حدائقُ الأسطحِ في المدنِ الحديثةِ',
    titleEn: 'Rooftop Gardens in Modern Cities',
    description:
      'Practice environmental vocabulary, urban sustainability terms, and structured argumentative paragraphs.',
    textAr: `معَ اتّساعِ المدنِ وارتفاعِ المباني السّكنيّةِ، تراجعتِ المساحاتُ الخضراءُ في كثيرٍ مِنَ الأحياءِ المزدحمةِ. ولمواجهةِ هذا التّحدّي، اتّجهَ عددٌ متزايدٌ مِنَ السّكّانِ والمعماريّينَ إلى استثمارِ أسطحِ المنازلِ وتحويلِها إلى حدائقَ مُنتجةٍ.

لا تقتصرُ فوائدُ هذهِ الحدائقِ على توفيرِ الأعشابِ والخضرواتِ الطّازجةِ فحسبُ، بلْ تُسهمُ أيضًا في خفضِ درجةِ حرارةِ المباني وتنقيةِ الهواءِ المحليِّ. إضافةً إلى ذلكَ، تخلقُ هذهِ المبادراتُ فضاءً اجتماعيًّا دافئًا يلتقي فيهِ الجيرانُ لتبادلِ الخبراتِ الزّراعيّةِ.`,
  },
  {
    level: 'intermediate',
    topicKey: 'maritime-navigation-astrolabe',
    titleAr: 'الملاحةُ البحريّةُ وقراءةُ النّجومِ',
    titleEn: 'Maritime Navigation and Star Reading',
    description:
      'Examine classical travel narratives, directional terms, and conditional structures.',
    textAr: `حينَ أبحرتِ السّفنُ التّجاريّةُ قديمًا في المحيطِ الهنديِّ والبحرِ الأحمرِ، لمْ يكنْ لدى البحّارةِ خرائطُ رقميّةٌ ولا أقمارٌ صناعيّةٌ. كانَ الرّبّانُ الخبيرُ يراقبُ مواقعَ النّجومِ في السّماءِ الصّافيةِ، ويستعينُ بالإسطرلابِ والبوصلةِ لتحديدِ المسارِ الصّحيحِ.

كما درسَ الملاحونَ اتّجاهاتِ الرّياحِ الموسميّةِ وتغيّراتِ لونِ المياهِ وقربَ الطّيورِ مِنَ السّاحلِ. وبفضلِ هذهِ المعرفةِ الميدانيّةِ المتراكمةِ، استطاعتِ القوافلُ البحريّةُ الرّبطَ بيْنَ الموانئِ البعيدةِ وتبادلَ التّوابلِ والمنسوجاتِ والمخطوطاتِ.`,
  },
  {
    level: 'intermediate',
    topicKey: 'podcasts-and-audio-reading',
    titleAr: 'عودةُ القراءةِ السّمعيّةِ في عصرِ السّرعةِ',
    titleEn: 'The Return of Audio Reading in a Fast Era',
    description:
      'Discuss modern media habits, cognitive comparisons, and balanced opinion expressions.',
    textAr: `شهدتِ السّنواتُ الأخيرةُ إقبالًا ملحوظًا على الكتبِ الصّوتيّةِ والبرامجِ الإذاعيّةِ المسجَّلةِ، خاصّةً بيْنَ الطّلبةِ والموظّفينَ الّذينَ يقضونَ وقتًا طويلًا في التّنقّلِ اليوْميِّ. فبضغطةِ زرٍّ واحدةٍ، يستطيعُ المستمعُ متابعةَ روايةٍ أدبيّةٍ أوْ سلسلةٍ تاريخيّةٍ أثناءَ المشيِ أوْ ركوبِ الحافلةِ.

ويرى كثيرٌ مِنَ التّربويّينَ أنَّ الاستماعَ المتأنّيَ يُنمّي الذّاكرةَ السّمعيّةَ ويُقرّبُ النّصوصَ الفصيحةَ إلى الأُذُنِ، على الرّغمِ مِنْ أنَّ القراءةَ البصريّةَ تظلُّ ضروريّةً لترسيخِ الإملاءِ والتّركيزِ العميقِ.`,
  },
  {
    level: 'intermediate',
    topicKey: 'desert-oases-aflaj-irrigation',
    titleAr: 'نظامُ الأفلاجِ وهندسةُ الواحاتِ',
    titleEn: 'The Aflaj System and Oasis Engineering',
    description:
      'Learn geographical terms, collective cooperation concepts, and technical descriptions.',
    textAr: `تُعدُّ الأفلاجُ مِنْ أذكى أنظمةِ الرّيِّ التّقليديّةِ في المناطقِ الجافّةِ؛ حيْثُ تنقلُ المياهَ الجوفيّةَ مِنْ ينابيعِ الجبالِ عبرَ قنواتٍ مائلةٍ بانحدارٍ محسوبٍ، فتصلُ إلى البساتينِ دونَ حاجةٍ إلى مضخّاتٍ كهربائيّةٍ.

وقدْ وضعَ السّكّانُ قواعدَ اجتماعيّةً دقيقةً لتوزيعِ الحصصِ المائيّةِ بيْنَ المزارعينَ بعدالةٍ، استنادًا إلى حركةِ الشّمسِ نهارًا ومواقعِ النّجومِ ليلًا. وهكذا تحوّلتِ الواحاتُ الصّحراويّةُ إلى حدائقَ مُثمرةٍ بالنّخيلِ واللّيمونِ والرّمّانِ.`,
  },
  {
    level: 'intermediate',
    topicKey: 'historic-arabic-bookshops',
    titleAr: 'ورّاقو الكتبِ ومجالسُ القراءةِ التّاريخيّةُ',
    titleEn: 'Historic Bookshops and Reading Circles',
    description:
      'Explore literary culture terms, intellectual exchange vocabulary, and narrative past-tense transitions.',
    textAr: `لمْ تكنْ أسواقُ الورّاقينَ في المدنِ العربيّةِ التّاريخيّةِ مجرّدَ دكاكينَ لبيعِ المخطوطاتِ والورقِ، بلْ كانتْ منتدياتٍ ثقافيّةً يلتقي فيها الطّلبةُ والشّعراءُ والمترجمونَ لمناقشةِ أحدثِ المؤلّفاتِ.

كانَ الورّاقُ الخبيرُ ينسخُ الكتبَ بخطٍّ واضحٍ، ويُشرفُ على تصحيحِها ومقابلتِها بالأصلِ الموثوقِ. وبفضلِ هذا التّكاملِ بيْنَ النّسخِ والحوارِ، ازدهرتْ حركةُ التّأليفِ وانتقلتِ المعارفُ العلميّةُ والأدبيّةُ عبرَ الأقاليمِ بيسرٍ.`,
  },
  {
    level: 'intermediate',
    topicKey: 'windcatchers-natural-cooling',
    titleAr: 'المَلاقفُ الهوائيّةُ وتبريدُ المنازلِ قديمًا',
    titleEn: 'Windcatchers and Traditional Home Cooling',
    description:
      'Learn architectural engineering terms, airflow nouns, and practical cause-and-effect clauses.',
    textAr: `ابتكرَ المعماريّونَ في المناطقِ الحارّةِ أبراجًا مرتفعةً فوقَ أسطحِ المنازلِ تُعرَفُ بالمَلاقفِ الهوائيّةِ، وذلكَ لاصطيادِ النّسيمِ العليلِ في الطّبقاتِ العُليا وتوجيهِهِ نحوَ الغُرفِ السّفليّةِ.

وحينَ يمرُّ الهواءُ المتدفّقُ فوقَ أحواضِ الماءِ أوْ الفخّارِ الرّطبِ، تنخفضُ حرارتُهُ بشكلٍ طبيعيٍّ قبلَ أنْ ينتشرَ في أنحاءِ الدّارِ. وتُدرَسُ هذهِ الفكرةُ الذّكيّةُ اليومَ بوصفِها نموذجًا ملهمًا للعمارةِ المستدامةِ قليلةِ الاستهلاكِ للطّاقةِ.`,
  },
  // ADVANCED
  {
    level: 'advanced',
    topicKey: 'rhetoric-of-conciseness-ijaz',
    titleAr: 'جمالُ الإيجازِ في البلاغةِ العربيّةِ',
    titleEn: 'The Aesthetics of Conciseness in Arabic Rhetoric',
    description:
      'Analyze classical rhetorical concepts, abstract nominal phrases, and nuanced literary style.',
    textAr: `احتلَّ مفهومُ الإيجازِ مكانةً رفيعةً في تراثِ النّقدِ والبلاغةِ العربيّةِ؛ إذْ لمْ يرَ البلاغيّونَ في البلاغةِ حشدًا للألفاظِ المترادفةِ، بلْ رأوْا فيها قدرةً فائقةً على تكثيفِ الدّلالةِ في أقلِّ حيّزٍ لَفْظيٍّ ممكنٍ دونَ إخلالٍ بالوضوحِ أوْ إضعافٍ للإيحاءِ.

ولذلكَ فرَّقَ النقّادُ بيْنَ الاختصارِ المخلِّ الّذي يبترُ المعنى، والإيجازِ البديعِ الّذي يفتحُ للقارئِ أُفقًا للتّأويلِ والتّأمّلِ. فالجملةُ الموجزةُ المحكمةُ تشبهُ البذرةَ الصّغيرةَ الّتي تنطوي على شجرةٍ كاملةٍ مِنَ المعاني، فتُشركُ المتلقّي في بناءِ الدّلالةِ وتُوقظُ خيالَهُ بدلَ أنْ تُثقلَ سمعَهُ بالتّفاصيلِ الزّائدةِ.`,
  },
  {
    level: 'advanced',
    topicKey: 'architecture-of-shadow-courtyards',
    titleAr: 'فلسفةُ الفِناءِ الدّاخليِّ في العمارةِ التّقليديّةِ',
    titleEn: 'Philosophy of the Courtyard in Traditional Architecture',
    description:
      'Engage with architectural philosophy, climate adaptation vocabulary, and complex clause transitions.',
    textAr: `يكشفُ البيتُ العربيُّ التّقليديُّ ذو الفِناءِ الدّاخليِّ عنْ رؤيةٍ معماريّةٍ تتعاملُ معَ المناخِ القاسي بوصفِهِ شريكًا في التّصميمِ لا خصمًا يُقاوَمُ بالآلاتِ. فالانفتاحُ نحوَ الدّاخلِ بدلَ الخارجِ يوفّرُ للأسرةِ خصوصيّةً بصريّةً وهدوءًا سمعيًّا معزولًا عنْ ضجيجِ الأسواقِ.

وفي قلبِ الفناءِ، تتضافرُ عناصرُ الظّلِّ والحجرِ والماءِ لتوليدِ حركةِ هواءٍ طبيعيّةٍ تُلطّفُ حرارةَ الصّيفِ وتختزنُ اعتدالَ اللّيلِ. وهكذا يتجلّى التّناغمُ بيْنَ الوظيفةِ البيئيّةِ والتّكوينِ الجماليِّ، ليُصبحَ المسكنُ واحةً مصغّرةً تستحضرُ السّكينةَ في صميمِ النّسيجِ الحضريِّ.`,
  },
  {
    level: 'advanced',
    topicKey: 'translation-ethics-cultural-bridges',
    titleAr: 'أخلاقيّاتُ التّرجمةِ وحدودُ الأمانةِ للنّصِّ',
    titleEn: 'Ethics of Translation and Fidelity to Text',
    description:
      'Examine comparative linguistics vocabulary, balanced antithesis, and academic argumentation.',
    textAr: `تقفُ التّرجمةُ الأدبيّةُ دائمًا على تخومٍ دقيقةٍ بيْنَ الوفاءِ الصّارمِ لبنيةِ النّصِّ الأصليِّ والاستجابةِ الحيّةِ لإيقاعِ اللّغةِ المستقبِلةِ. فالنّقلُ الحرفيُّ قدْ يحفظُ ظاهرَ المفرداتِ، لكنّهُ كثيرًا ما يُفرغُ العبارةَ مِنْ ظلالِها الشّعوريّةِ وإحالاتِها الثّقافيّةِ العميقةِ.

مِنْ هنا، يضطلعُ المترجمُ بدورِ الوسيطِ المعرفيِّ الّذي يقرأُ المسكوتَ عنْهُ خلفَ التّراكيبِ، محاولًا إعادةَ صياغةِ التّجربةِ الإنسانيّةِ بلسانٍ جديدٍ دونَ تزييفٍ أوْ استعلاءٍ. إنَّ التّرجمةَ الصّادقةَ ليستْ استبدالَ معجمٍ بآخرَ، بلْ حوارٌ متكافئٌ بيْنَ ذاكرتَيْنِ حضاريّتَيْنِ يوسّعُ أُفقَ الفهمِ المشتركِ.`,
  },
  {
    level: 'advanced',
    topicKey: 'memory-of-ancient-trees-ecology',
    titleAr: 'الأشجارُ المعمِّرةُ كأرشيفٍ حيٍّ للمناخِ',
    titleEn: 'Ancient Trees as Living Climate Archives',
    description:
      'Explore scientific prose, ecological metaphors, and extended relative/appositive clauses.',
    textAr: `لا يرى علماءُ البيئةِ في الأشجارِ المعمِّرةِ مجرّدَ معالمَ طبيعيّةٍ تزيّنُ الجبالَ والوديانَ، بلْ ينظرونَ إليْها بوصفِها سجلّاتٍ حيّةً توثّقُ تقلّباتِ المناخِ عبرَ مئاتِ السّنينَ. فكلُّ حلقةٍ خشبيّةٍ تتكوّنُ في جذعِ الشّجرةِ تختزنُ شهادةً دقيقةً عنْ وفرةِ الأمطارِ أوْ قسوةِ الجفافِ في عامٍ مضى.

ومِنْ خلالِ تحليلِ هذهِ الطّبقاتِ المتراكمةِ، يستطيعُ الباحثونَ إعادةَ رسمِ خرائطِ التّغيّراتِ المناخيّةِ القديمةِ ومقارنتِها بالتحوّلاتِ المعاصرةِ. إنَّ صوْنَ الغاباتِ العتيقةِ لا يحمي التّنوّعَ الحيويَّ فحسبُ، بلْ يصونُ ذاكرةَ الأرضِ نَفْسَها مِنْ أنْ تطمسَها العجلةُ الصّناعيّةُ.`,
  },
  {
    level: 'advanced',
    topicKey: 'arabic-calligraphy-rhythm-proportion',
    titleAr: 'الإيقاعُ والتّناسبُ في الخطِّ العربيِّ',
    titleEn: 'Rhythm and Proportion in Arabic Calligraphy',
    description:
      'Study artistic proportions, abstract morphological patterns, and classical aesthetic terminology.',
    textAr: `تجاوزَ الخطُّ العربيُّ منذُ قرونٍ وظيفتَهُ التّدوينيّةَ المجرّدةَ ليغدوَ فنًّا بصريًّا قائمًا على التّوازنِ الهندسيِّ والإيقاعِ الحركيِّ. فقدْ وضعَ الخطّاطونَ الأوائلُ موازينَ دقيقةً تعتمدُ على النّقطةِ المربّعةِ بوصفِها وحدةَ القياسِ الّتي تُضبطُ بها استقامةُ الألفِ واستدارةُ النّونِ وامتدادُ الباءِ.

وبيْنَ صرامةِ القاعدةِ وحرّيّةِ القلمِ، تنبثقُ في اللّوحةِ الخطّيّةِ علاقةٌ جدليّةٌ بيْنَ الكتلةِ السّوداءِ والفراغِ الأبيضِ، أشبهُ ما تكونُ بتوقيعٍ موسيقيٍّ مرئيٍّ. ولعلَّ سرَّ ديمومةِ هذا الفنِّ يكمنُ في قدرتِهِ على تجديدِ أشكالِهِ دونَ أنْ يفقدَ صلتهُ بجوهرِ التّناسبِ الكلاسيكيِّ.`,
  },
  {
    level: 'advanced',
    topicKey: 'ethics-of-slow-deliberation',
    titleAr: 'فضيلةُ التّروّي في زمنِ التّدفّقِ المعلوماتيِّ',
    titleEn: 'The Virtue of Deliberation in an Era of Information Flow',
    description:
      'Practice philosophical reflection, nuanced modal expressions, and contemporary essay rhetoric.',
    textAr: `أفرزتِ المنصّاتُ الرّقميّةُ المعاصرةُ إيقاعًا متسارعًا يختزلُ القضايا المركّبةَ في انطباعاتٍ فوريّةٍ وتعليقاتٍ عابرةٍ، الأمرُ الّذي جعلَ التّروّيَ الفكريَّ عملةً نادرةً في الفضاءِ العامِّ. فالسّرعةُ في استهلاكِ الأخبارِ قدْ تمنحُ الفردَ وهمَ الإحاطةِ الشّاملةِ، لكنّها كثيرًا ما تُضعفُ مَلَكةَ التّمحيصِ النّقديِّ.

إنَّ استعادةَ مسافةِ التّأمّلِ تقتضي تدريبَ النّفسِ على التّريّثِ أمامَ الأحكامِ الجاهزةِ، ومقارنةِ المصادرِ المتعدّدةِ، والتمييزِ بيْنَ الضّجيجِ العاطفيِّ والحجّةِ المتماسكةِ. فالمعرفةُ الرّاسخةُ لا تنضجُ في عجالةِ التّمريرِ، بلْ في صمتِ القراءةِ المتأنّيةِ ومساءلةِ الذّاتِ.`,
  },
  {
    level: 'advanced',
    topicKey: 'lexicography-and-semantic-shift',
    titleAr: 'تحوّلاتُ الدّلالةِ في المعاجمِ العربيّةِ',
    titleEn: 'Semantic Shift in Arabic Lexicography',
    description:
      'Investigate historical linguistics, metaphorical extension, and classical lexical methodology.',
    textAr: `يُظهرُ تتبُّعُ المفرداتِ في المعاجمِ العربيّةِ الكلاسيكيّةِ أنَّ اللّغةَ كائنٌ حيٌّ تتسعُ دلالاتُهُ باستمرارٍ دونَ أنْ تنقطعَ صلتُهُ بجذورِهِ الحسّيّةِ الأولى. فكثيرٌ مِنَ المصطلحاتِ الفكريّةِ المجرّدةِ اليومَ انبثقتْ في الأصلِ مِنْ مشاهدَ مادّيّةٍ ملموسةٍ في البيئةِ اليوميّةِ، ثمَّ انتقلتْ عبرَ المجازِ والاستعارةِ إلى حقولِ الفلسفةِ والقانونِ والنّقدِ.

وهذا التّراكمُ الدّلاليُّ يُلزمُ الدّارسَ المتعمّقَ ألّا يكتفيَ بالمعنى المعاصرِ الشّائعِ للّفظةِ، بلْ يغوصَ في سياقاتِها التّاريخيّةِ ليرصدَ كيفَ صاغتِ التّجربةُ الإنسانيّةُ طبقاتِ المعنى جيْلًا بعدَ جيلٍ.`,
  },
  {
    level: 'advanced',
    topicKey: 'silence-and-music-in-prose',
    titleAr: 'بلاغةُ الصّمتِ والإيقاعِ في النّثرِ الأدبيِّ',
    titleEn: 'The Rhetoric of Silence and Rhythm in Literary Prose',
    description:
      'Examine prose cadence, structural antithesis, and subtle expressive restraint in Arabic literature.',
    textAr: `لا يعتمدُ النّثرُ الأدبيُّ الرّفيعُ على تتابعِ العباراتِ الرّنّانةِ بقدرِ ما يعتمدُ على توزيعِ الوقفاتِ الذّكيّةِ الّتي تتيحُ للمعنى أنْ يتردّدَ في ذهنِ القارئِ بعدَ انقضاءِ الجملةِ. فالصّمتُ الموحي بيْنَ الفقراتِ يؤدّي وظيفةً موسيقيّةً تُعادلُ فواصلَ النّغمِ في المقطوعاتِ الكلاسيكيّةِ.

ومتى أدركَ الكاتبُ متى يُمسكُ القلمَ عنِ الإطالةِ، تحوّلتِ المساحةُ المتروكةُ للتّأمّلِ إلى جسرٍ خفيٍّ يلتقي عليهِ حدسُ المؤلّفِ بوعيِ المتلقّي، فيغدو النّصُّ مساحةً مشتركةً للإبداعِ لا مجرّدَ رسالةٍ أحاديّةِ الاتّجاهِ.`,
  },
];

export function buildDailyCurriculumDraftLesson(
  seed: CurriculumLessonSeed,
  dateKey: string,
  slotIndex: number
): Lesson {
  const formattedTitleAr = applySmartPartialTashkeel(seed.titleAr.trim());
  const formattedTextAr = applySmartPartialTashkeel(seed.textAr.trim());
  const wordCount = countArabicWords(formattedTextAr);
  const slug = normalizeCurriculumTopicKey(seed.topicKey || seed.titleEn || seed.titleAr) || `slot-${slotIndex}`;

  return {
    id: `daily-${dateKey}-${seed.level}-${slotIndex}-${slug.slice(0, 28)}`,
    titleEn: seed.titleEn.trim(),
    titleAr: formattedTitleAr,
    level: seed.level,
    description: seed.description.trim(),
    contentType: 'text',
    readingTimeMinutes: Math.max(2, Math.ceil((wordCount || 60) / 35)),
    textAr: formattedTextAr,
    isCustom: true,
    authorName: 'Qalam Curriculum Agent',
    authorId: 'system-curriculum-agent',
    authorRole: 'admin',
    // Strictly saved as draft (isPublic: false) awaiting Admin approval
    isPublic: false,
    status: 'draft',
    isDailyCurriculum: true,
    curriculumDate: dateKey,
    topicKey: slug,
    createdAt: Date.now() + slotIndex,
  };
}

export function selectFallbackSeedsForLevel(
  level: ProficiencyLevel,
  neededCount: number,
  seenTopics: Set<string>,
  dateKey: string
): CurriculumLessonSeed[] {
  if (neededCount <= 0) return [];
  const pool = CURATED_CURRICULUM_BANK.filter((item) => item.level === level);
  if (pool.length === 0) return [];

  // Deterministic date offset so each day starts at a fresh topic index
  const dateHash = Array.from(dateKey).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const offset = dateHash % pool.length;
  const rotated = [...pool.slice(offset), ...pool.slice(0, offset)];

  const chosen: CurriculumLessonSeed[] = [];
  for (const candidate of rotated) {
    if (chosen.length >= neededCount) break;
    if (!isTopicDuplicate(candidate, seenTopics)) {
      registerSeenTopic(candidate, seenTopics);
      chosen.push(candidate);
    }
  }
  return chosen;
}
