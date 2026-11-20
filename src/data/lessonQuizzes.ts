import type { LessonQuizQuestion } from '../types/arabic.ts';
import { applySmartPartialTashkeel } from '../utils/arabic.ts';

const SAMPLE_LESSON_QUIZZES: Record<string, LessonQuizQuestion[]> = {
  'beg-morning-market': [
    {
      id: 'q1',
      questionEn: 'What does Kareem drink before leaving his house in the morning?',
      questionAr: 'ماذا يشربُ كريمٌ قبلَ أنْ يخرجَ منَ البيْتِ في الصّباحِ؟',
      options: [
        'A cup of hot coffee (فنجانًا منَ القهوةِ السّاخنةِ)',
        'Mint tea (الشّايَ بالنّعناعِ)',
        'Cold water (ماءً باردًا)',
        'Fresh orange juice (عصيرَ البرتقالِ)',
      ],
      correctIndex: 0,
      explanation: 'The passage states: "ويشربُ فنجانًا منَ القهوةِ السّاخنةِ."',
    },
    {
      id: 'q2',
      questionEn: 'Which items does Kareem ask about at the fruit stall?',
      questionAr: 'عمّا يسألُ كريمٌ أمامَ دكّانِ الفواكهِ؟',
      options: [
        'Bananas and figs',
        'Fresh apples and delicious dates (تفّاحٌ طازجٌ وتمرٌ لذيذٌ)',
        'Olives and cheese',
        'Roasted coffee beans',
      ],
      correctIndex: 1,
      explanation: 'Kareem asks: "هلْ عندَكَ تفّاحٌ طازجٌ وتمرٌ لذيذٌ؟"',
    },
    {
      id: 'q3',
      questionEn: 'What does Kareem buy before returning home happily?',
      questionAr: 'ماذا يشتري كريمٌ قبلَ أنْ يعودَ إلى المنزلِ مسرورًا؟',
      options: [
        'Books and newspapers',
        'Warm bread and honey (الخبزَ الدّافئَ والعسلَ)',
        'Spices and saffron',
        'Flowers for the garden',
      ],
      correctIndex: 1,
      explanation: 'At the end: "يشتري كريمٌ الخبزَ الدّافئَ والعسلَ، ثمَّ يعودُ إلى المنزلِ مسرورًا."',
    },
  ],
  'beg-family-garden': [
    {
      id: 'q1',
      questionEn: 'Where does Salma’s family sit every evening to talk about their day?',
      questionAr: 'أينَ تجلسُ الأسرةُ في كلِّ مساءٍ للتّحدّثِ عنْ أحداثِ اليوْمِ؟',
      options: [
        'Under the jasmine tree (تحتَ شجرةِ الياسمينِ)',
        'Inside the old market',
        'By a marble fountain',
        'At a neighborhood café',
      ],
      correctIndex: 0,
      explanation: 'The passage says: "تجلسُ الأسرةُ تحتَ شجرةِ الياسمينِ."',
    },
    {
      id: 'q2',
      questionEn: 'What does Salma’s brother Tariq do in the garden?',
      questionAr: 'ماذا يفعلُ طارقٌ أخو سلمى في الحديقةِ؟',
      options: [
        'He waters the red flowers',
        'He reads a useful book on the wooden bench',
        'He prepares mint tea',
        'He walks to the market',
      ],
      correctIndex: 1,
      explanation: 'Tariq reads a useful book: "فيقرأُ كتابًا مفيدًا على المقعدِ الخشبيِّ."',
    },
    {
      id: 'q3',
      questionEn: 'What does the mother prepare for everyone?',
      questionAr: 'ماذا تحضّرُ الأمُّ للجميعِ؟',
      options: [
        'Arabic coffee with cardamom',
        'Fresh mint tea (الشّايَ بالنّعناعِ الطّازجِ)',
        'Warm bread and honey',
        'Fresh dates and milk',
      ],
      correctIndex: 1,
      explanation: 'The text states: "تبتسمُ الأمُّ وتحضّرُ الشّايَ بالنّعناعِ الطّازجِ."',
    },
  ],
  'int-house-of-wisdom': [
    {
      id: 'q1',
      questionEn: 'During which historical era did the House of Wisdom in Baghdad flourish?',
      questionAr: 'في أيِّ عصرٍ ازدهرَ بيْتُ الحكمةِ في بغدادَ؟',
      options: [
        'The Abbasid era (العصرِ العبّاسيِّ)',
        'The Andalusian era',
        'The Modern era',
        'The Pre-Islamic era',
      ],
      correctIndex: 0,
      explanation: 'The opening sentence calls it "مركزًا علميًّا بارزًا في العصرِ العبّاسيِّ."',
    },
    {
      id: 'q2',
      questionEn: 'Which fields did scholars study at the House of Wisdom?',
      questionAr: 'ما العلومُ الّتي درسَها العلماءُ في بيْتِ الحكمةِ؟',
      options: [
        'Architecture and mosaic art only',
        'Philosophy, medicine, astronomy, and mathematics',
        'Poetry and trade exclusively',
        'Agriculture and irrigation',
      ],
      correctIndex: 1,
      explanation: 'The text lists: "لدراسةِ الفلسفةِ والطّبِّ والفلكِ والرّياضيّاتِ."',
    },
    {
      id: 'q3',
      questionEn: 'Beyond translating old manuscripts, what else did the researchers contribute?',
      questionAr: 'إلى جانبِ نقلِ المخطوطاتِ القديمةِ، ماذا أضافَ الباحثونَ؟',
      options: [
        'Commentaries and new innovations (شروحًا وابتكاراتٍ جديدةً)',
        'Hospitality etiquette rules',
        'Commercial markets',
        'Musical compositions',
      ],
      correctIndex: 0,
      explanation: 'The passage notes: "وأضافوا إليْها شروحًا وابتكاراتٍ جديدةً أسهمتْ في تقدّمِ المعرفةِ الإنسانيّةِ."',
    },
  ],
  'int-art-of-hospitality': [
    {
      id: 'q1',
      questionEn: 'What does Arabic coffee symbolize according to the passage?',
      questionAr: 'إلى ماذا ترمزُ القهوةُ العربيّةُ حسبَ النّصِّ؟',
      options: [
        'Generosity and warm hospitality (الكرمِ وحسنِ الضّيافةِ)',
        'Speed and efficiency',
        'Academic scholarship',
        'Architectural balance',
      ],
      correctIndex: 0,
      explanation: 'The opening line states: "تعدُّ القهوةُ العربيّةُ رمزًا أصيلًا للكرمِ وحسنِ الضّيافةِ."',
    },
    {
      id: 'q2',
      questionEn: 'Which spices are boiled with the freshly ground coffee?',
      questionAr: 'ما التّوابلُ الّتي تُغلى معَ القهوةِ؟',
      options: [
        'Mint and cinnamon',
        'Cardamom and saffron (الهيلِ والزّعفرانِ)',
        'Honey and dates',
        'Cloves and ginger',
      ],
      correctIndex: 1,
      explanation: 'The host boils it "معَ الهيلِ والزّعفرانِ لتفوحَ رائحتُها الزّكيّةُ."',
    },
    {
      id: 'q3',
      questionEn: 'According to traditional etiquette, how much coffee does the host pour into the cup?',
      questionAr: 'كمْ يصبُّ المضيفُ في الفنجانِ وفقَ آدابِ تقديمِ القهوةِ؟',
      options: [
        'He fills the cup completely to the brim',
        'A small amount without filling it (مقدارًا قليلًا دونَ أنْ يملأَهُ)',
        'Half a cup with cold water',
        'Only after the guest leaves',
      ],
      correctIndex: 1,
      explanation: 'The text explains: "ويصبُّ مقدارًا قليلًا دونَ أنْ يملأَهُ."',
    },
  ],
  'adv-language-and-thought': [
    {
      id: 'q1',
      questionEn: 'How does the author describe language beyond simply transferring information?',
      questionAr: 'كيْفَ يصفُ النّصُّ اللّغةَ بعيدًا عنْ كونِها مجرّدَ أداةٍ لنقلِ المعلوماتِ؟',
      options: [
        'As a living vessel where concepts and philosophical visions take shape',
        'As a rigid mathematical formula',
        'As a temporary spoken habit',
        'As an architectural ornament',
      ],
      correctIndex: 0,
      explanation: 'The text states: "إنّما هيَ الوعاءُ الحيُّ الّذي تتشكّلُ فيهِ المفاهيمُ وتتبلورُ مِنْ خلالِهِ الرّؤى الفلسفيّةُ."',
    },
    {
      id: 'q2',
      questionEn: 'What distinct feature of Arabic enables wide semantic generation from a single lexical pattern?',
      questionAr: 'ما الخاصّيّةُ الّتي تتيحُ للعربيّةِ توليدَ معانٍ مترابطةٍ؟',
      options: [
        'Its capacity for morphological derivation (الاشتقاقِ والتّوليدِ الدّلاليِّ)',
        'Borrowing foreign alphabets',
        'Shortening every sentence to two words',
        'Eliminating all vowels',
      ],
      correctIndex: 0,
      explanation: 'The passage highlights "قدرتُها الفائقةُ على الاشتقاقِ والتّوليدِ الدّلاليِّ."',
    },
    {
      id: 'q3',
      questionEn: 'What does a contemplative reader perceive between the lines?',
      questionAr: 'ماذا يدركُ القارئُ المتأمّلُ بيْنَ السّطورِ؟',
      options: [
        'Hidden connotations and the harmony between form and meaning',
        'Only literal dictionary dates',
        'Everyday shopping lists',
        'Unrelated grammatical errors',
      ],
      correctIndex: 0,
      explanation: 'The final sentence says: "أنْ يستشرفَ الدّلالاتِ الخفيّةَ... وأنْ يدركَ التّناغمَ البديعَ بيْنَ المبنى والمعنى."',
    },
  ],
  'adv-andalusian-architecture': [
    {
      id: 'q1',
      questionEn: 'What silent dialogue appears in Andalusian architecture?',
      questionAr: 'ما الحوارُ الصّامتُ الّذي يتجلّى في العمارةِ الأندلسيّةِ؟',
      options: [
        'Between geometric solidity and delicate light filtering through arches',
        'Between heavy iron gates and loud markets',
        'Between modern skyscrapers and stone bridges',
        'Between wooden boats and river docks',
      ],
      correctIndex: 0,
      explanation: 'The text begins: "حوارٌ صامتٌ بيْنَ الصّلابةِ الهندسيّةِ ورقّةِ الضّوْءِ المتسلّلِ عبرَ الأقواسِ."',
    },
    {
      id: 'q2',
      questionEn: 'How did the classical architect view empty space (الفراغ)?',
      questionAr: 'كيْفَ نظرَ المعماريُّ القديمُ إلى الفراغِ؟',
      options: [
        'As wasted territory to fill with walls',
        'As an essential element weaving stillness and contemplation',
        'As a sign of incomplete construction',
        'As space solely for commercial stalls',
      ],
      correctIndex: 1,
      explanation: 'The passage notes: "بلْ هوَ عنصرٌ جوهريٌّ ينسجُ فيهِ السّكونُ والتّأمّلُ."',
    },
    {
      id: 'q3',
      questionEn: 'What combines in the courtyards of the Alhambra to ease the heat and bring serenity?',
      questionAr: 'ماذا يتكاملُ في أفنيةِ قصرِ الحمراءِ لتخفيفِ الحرِّ وبعثِ الطّمأنينةِ؟',
      options: [
        'The murmur of water and mathematical symmetry in mosaic work',
        'Electric lamps and glass windows',
        'Thick carpets and fireplaces',
        'Loud music and market bells',
      ],
      correctIndex: 0,
      explanation: 'The second paragraph describes "خريرُ الماءِ معَ التّناظرِ الرّياضيِّ في الفُسَيْفِسَاءِ."',
    },
  ],
};

export function generateFallbackLessonQuiz(
  lessonId: string | undefined,
  textAr: string,
  titleEn: string
): LessonQuizQuestion[] {
  if (lessonId && SAMPLE_LESSON_QUIZZES[lessonId]) {
    return SAMPLE_LESSON_QUIZZES[lessonId].map((q) => ({
      ...q,
      questionAr: applySmartPartialTashkeel(q.questionAr),
    }));
  }

  // Grounded fallback for custom user-uploaded texts when offline
  const sentences = textAr
    .split(/[.؟!؛\n]+/)
    .map((s) => applySmartPartialTashkeel(s.trim()))
    .filter((s) => s.length > 10);

  const s1 = sentences[0] || applySmartPartialTashkeel(textAr.slice(0, 80));
  const s2 = sentences[1] || s1;
  const words = s1.split(/\s+/).filter((w) => w.length >= 3);
  const focusWord = words[Math.min(1, words.length - 1)] || words[0] || 'النّصّ';

  return [
    {
      id: 'custom-q1',
      questionEn: `Which statement directly appears in "${titleEn}"?`,
      questionAr: 'أيُّ عبارةٍ وردتْ في النّصِّ الّذي قرأتَهُ للتّوِّ؟',
      options: [
        s1.slice(0, 72) + (s1.length > 72 ? '...' : ''),
        'يتحدّثُ النّصُّ عنْ رحلةٍ فضائيّةٍ إلى كوكبِ المشتري.',
        'يصفُ النّصُّ قواعدَ لعبةِ الشّطرنجِ في القرونِ الوسطى.',
        'يتناولُ النّصُّ أسعارَ العملاتِ في البورصةِ العالميّةِ.',
      ],
      correctIndex: 0,
      explanation: 'This sentence comes directly from the opening of the passage.',
    },
    {
      id: 'custom-q2',
      questionEn: `Which Arabic word appears in the opening sentence of the reading?`,
      questionAr: 'أيُّ كلمةٍ وردتْ في الجملةِ الأولى منَ النّصِّ؟',
      options: [
        'الصّاروخُ',
        focusWord,
        'المحيطُ الأطلسيُّ',
        'المختبرُ النّوويُّ',
      ],
      correctIndex: 1,
      explanation: `The word "${focusWord}" appears in the passage you just read.`,
    },
    {
      id: 'custom-q3',
      questionEn: 'Which continuation matches the passage?',
      questionAr: 'أيُّ جملةٍ تنسجمُ معَ سياقِ النّصِّ؟',
      options: [
        'لا توجدُ أيُّ تفاصيلَ عربيّةٍ في هذا الدّرسِ.',
        'ينصحُ النّصُّ بتركِ القراءةِ فورًا.',
        s2.slice(0, 72) + (s2.length > 72 ? '...' : ''),
        'يتكوّنُ النّصُّ مِنْ أرقامٍ رياضيّةٍ فقطْ.',
      ],
      correctIndex: 2,
      explanation: 'This line is taken directly from the text you read.',
    },
  ];
}
