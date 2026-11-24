import type { ProficiencyLevel, SentencePair, WordAnalysis } from '../types/arabic.ts';
import {
  applySmartPartialTashkeel,
  countArabicWords,
  formatMinimalArabicRoot,
  inferArabicWordType,
  normalizeArabicWord,
  normalizeStandaloneArabicKey,
  normalizeStandaloneVocabWord,
  stripFinalIrabForSpeech,
  stripTashkeel,
} from '../utils/arabic.ts';

type LexiconEntry = Omit<WordAnalysis, 'word' | 'source' | 'notice'>;

const RAW_LEXICON: Record<string, LexiconEntry> = {
  // Core particles & connectors
  'في': {
    wordWithTashkeel: 'فِي',
    partOfSpeech: 'Preposition',
    transliteration: 'fī',
    englishMeaning: 'in / inside / at',
    examples: [
      { arabic: 'يَجْلِسُ الطَّالِبُ فِي المَكْتَبَةِ الهادِئَةِ.', english: 'The student sits in the quiet library.' },
      { arabic: 'تَزْدَهِرُ الأَزْهَارُ فِي فَصْلِ الرَّبِيعِ.', english: 'Flowers bloom in the spring season.' },
    ],
  },
  'من': {
    wordWithTashkeel: 'مِنْ',
    partOfSpeech: 'Preposition',
    transliteration: 'min',
    englishMeaning: 'from / of',
    examples: [
      { arabic: 'عَادَ المُسَافِرُ مِنَ المَدِينَةِ مُبَكِّرًا.', english: 'The traveler returned from the city early.' },
      { arabic: 'شَرِبْتُ كُوبًا مِنَ المَاءِ البَارِدِ.', english: 'I drank a glass of cold water.' },
    ],
  },
  'الي': {
    wordWithTashkeel: 'إِلَى',
    partOfSpeech: 'Preposition',
    transliteration: 'ilā',
    englishMeaning: 'to / toward',
    examples: [
      { arabic: 'يَذْهَبُ الأَطْفَالُ إِلَى المَدْرَسَةِ صَبَاحًا.', english: 'The children go to school in the morning.' },
      { arabic: 'أَرْسَلْتُ رِسَالَةً إِلَى صَدِيقِي القَدِيمِ.', english: 'I sent a letter to my old friend.' },
    ],
  },
  'علي': {
    wordWithTashkeel: 'عَلَى',
    partOfSpeech: 'Preposition',
    transliteration: 'ʿalā',
    englishMeaning: 'on / upon / over',
    examples: [
      { arabic: 'وَضَعَ المُعَلِّمُ الكِتَابَ عَلَى الطَّاوِلَةِ.', english: 'The teacher placed the book on the table.' },
      { arabic: 'يُحَافِظُ المُجْتَمَعُ عَلَى تُرَاثِهِ العَرِيقِ.', english: 'The community preserves its rich heritage.' },
    ],
  },
  'مع': {
    wordWithTashkeel: 'مَعَ',
    partOfSpeech: 'Preposition',
    transliteration: 'maʿa',
    englishMeaning: 'with / together with',
    examples: [
      { arabic: 'تَتَنَاوَلُ الأُسْرَةُ الغَدَاءَ مَعَ الأَقَارِبِ.', english: 'The family has lunch with relatives.' },
      { arabic: 'تَحَدَّثْتُ مَعَ الأُسْتَاذِ عَنِ الدَّرْسِ الجَدِيدِ.', english: 'I spoke with the professor about the new lesson.' },
    ],
  },
  'ثم': {
    wordWithTashkeel: 'ثُمَّ',
    partOfSpeech: 'Conjunction',
    transliteration: 'thumma',
    englishMeaning: 'then / afterwards',
    examples: [
      { arabic: 'قَرَأَ النَّصَّ ثُمَّ لَخَّصَ أَفْكَارَهُ الرَّئِيسَةَ.', english: 'He read the text, then summarized its main ideas.' },
      { arabic: 'تَوَقَّفَ القِطَارُ قَلِيلًا ثُمَّ وَاصَلَ رِحْلَتَهُ.', english: 'The train stopped briefly, then continued its journey.' },
    ],
  },
  'كان': {
    wordWithTashkeel: 'كَانَ',
    partOfSpeech: 'Verb (Past)',
    transliteration: 'kāna',
    englishMeaning: 'was / existed',
    examples: [
      { arabic: 'كَانَ الجَوُّ مُعْتَدِلًا فِي تِلْكَ الأَمْسِيَةِ.', english: 'The weather was mild on that evening.' },
      { arabic: 'كَانَ البَيْتُ مَلِيئًا بِالكُتُبِ وَالمَخْطُوطَاتِ.', english: 'The house was full of books and manuscripts.' },
    ],
  },

  // Lesson 1: Morning in the Old Market
  'يستيقظ': {
    wordWithTashkeel: 'يَسْتَيْقِظُ',
    partOfSpeech: 'Verb (Present)',
    transliteration: 'yastayqiẓu',
    englishMeaning: 'he wakes up',
    examples: [
      { arabic: 'يَسْتَيْقِظُ الطَّالِبُ مُبَكِّرًا لِيَسْتَعِدَّ لِلِامْتِحَانِ.', english: 'The student wakes up early to prepare for the exam.' },
      { arabic: 'يَسْتَيْقِظُ الفَلَّاحُ قَبْلَ شُرُوقِ الشَّمْسِ كُلَّ يَوْمٍ.', english: 'The farmer wakes up before sunrise every day.' },
    ],
  },
  'كريم': {
    wordWithTashkeel: 'كَرِيمٌ',
    partOfSpeech: 'Proper Noun / Adjective',
    transliteration: 'Karīm',
    englishMeaning: 'Kareem (name) / generous',
    examples: [
      { arabic: 'يُحِبُّ كَرِيمٌ المَشْيَ فِي الصَّبَاحِ البَاكِرِ.', english: 'Kareem loves walking in the early morning.' },
      { arabic: 'اِسْتَقْبَلَنَا المَضِيفُ بِوَجْهٍ بَشُوشٍ وَقَلْبٍ كَرِيمٍ.', english: 'The host welcomed us with a cheerful face and a generous heart.' },
    ],
  },
  'مبكرا': {
    wordWithTashkeel: 'مُبَكِّرًا',
    partOfSpeech: 'Adverb',
    transliteration: 'mubakkiran',
    englishMeaning: 'early',
    examples: [
      { arabic: 'وُصُولُكَ مُبَكِّرًا إِلَى الاجْتِمَاعِ يَدُلُّ عَلَى احْتِرَامِ الوَقْتِ.', english: 'Your arriving early to the meeting shows respect for time.' },
      { arabic: 'تَنَامُ الأُسْرَةُ مُبَكِّرًا فِي أَيَّامِ الدِّرَاسَةِ.', english: 'The family goes to sleep early on school days.' },
    ],
  },
  'الصباح': {
    wordWithTashkeel: 'الصَّبَاحُ',
    partOfSpeech: 'Noun',
    transliteration: 'aṣ-ṣabāḥ',
    englishMeaning: 'the morning',
    examples: [
      { arabic: 'أُفَضِّلُ القِرَاءَةَ فِي الصَّبَاحِ عِنْدَمَا يَكُونُ البَيْتُ هَادِئًا.', english: 'I prefer reading in the morning when the house is quiet.' },
      { arabic: 'نَسِيمُ الصَّبَاحِ يُنْعِشُ النَّفْسَ وَيَمْنَحُهَا نَشَاطًا.', english: 'The morning breeze refreshes the soul and grants it energy.' },
    ],
  },
  'الباكر': {
    wordWithTashkeel: 'البَاكِرُ',
    partOfSpeech: 'Adjective',
    transliteration: 'al-bākir',
    englishMeaning: 'early (hour)',
    examples: [
      { arabic: 'خَرَجْنَا فِي الصَّبَاحِ البَاكِرِ قَبْلَ ازْدِحَامِ الطُّرُقِ.', english: 'We went out in the early morning before traffic got crowded.' },
      { arabic: 'يَبْدَأُ المَخْبَزُ عَمَلَهُ فِي الوَقْتِ البَاكِرِ مِنَ الفَجْرِ.', english: 'The bakery begins its work at the early hour of dawn.' },
    ],
  },
  'يشرب': {
    wordWithTashkeel: 'يَشْرَبُ',
    partOfSpeech: 'Verb (Present)',
    transliteration: 'yashrabu',
    englishMeaning: 'he drinks',
    examples: [
      { arabic: 'يَشْرَبُ المُسَافِرُ كُوبًا مِنَ المَاءِ البَارِدِ بَعْدَ الرِّحْلَةِ.', english: 'The traveler drinks a glass of cold water after the journey.' },
      { arabic: 'يَشْرَبُ جَدِّي الشَّايَ الأَخْضَرَ بَعْدَ الغَدَاءِ.', english: 'My grandfather drinks green tea after lunch.' },
    ],
  },
  'فنجانا': {
    wordWithTashkeel: 'فِنْجَانًا',
    partOfSpeech: 'Noun',
    transliteration: 'finjānan',
    englishMeaning: 'a cup (small cup)',
    examples: [
      { arabic: 'قَدَّمَ المَضِيفُ فِنْجَانًا مِنَ القَهْوَةِ السَّاخِنَةِ لِضَيْفِهِ.', english: 'The host offered a cup of hot coffee to his guest.' },
      { arabic: 'اِشْتَرَيْتُ فِنْجَانًا خَزَفِيًّا مَرْسُومًا بِاليَدِ.', english: 'I bought a hand-painted ceramic cup.' },
    ],
  },
  'القهوة': {
    wordWithTashkeel: 'القَهْوَةُ',
    partOfSpeech: 'Noun',
    transliteration: 'al-qahwa',
    englishMeaning: 'the coffee',
    examples: [
      { arabic: 'رَائِحَةُ القَهْوَةِ العَرَبِيَّةِ تَمْلَأُ أَرْجَاءَ المَطْبَخِ.', english: 'The aroma of Arabic coffee fills the corners of the kitchen.' },
      { arabic: 'يَجْتَمِعُ الأَصْدِقَاءُ لِشُرْبِ القَهْوَةِ وَتَبَادُلِ الأَخْبَارِ.', english: 'Friends gather to drink coffee and exchange news.' },
    ],
  },
  'الساخنة': {
    wordWithTashkeel: 'السَّاخِنَةُ',
    partOfSpeech: 'Adjective',
    transliteration: 'as-sākhina',
    englishMeaning: 'hot / warm',
    examples: [
      { arabic: 'تُقَدَّمُ الشُّورْبَةُ السَّاخِنَةُ فِي فَصْلِ الشِّتَاءِ.', english: 'Hot soup is served during the winter season.' },
      { arabic: 'اِنْتَبِهْ عِنْدَ حَمْلِ الأَكْوَابِ السَّاخِنَةِ.', english: 'Be careful when carrying hot cups.' },
    ],
  },
  'يخرج': {
    wordWithTashkeel: 'يَخْرُجُ',
    partOfSpeech: 'Verb (Present)',
    transliteration: 'yakhruju',
    englishMeaning: 'he goes out / exits',
    examples: [
      { arabic: 'يَخْرُجُ المُوَظَّفُ مِنْ مَكْتَبِهِ فِي السَّاعَةِ الخَامِسَةِ.', english: 'The employee leaves his office at five o’clock.' },
      { arabic: 'لَا يَخْرُجُ النَّاسُ كَثِيرًا عِنْدَمَا يَشْتَدُّ المَطَرُ.', english: 'People do not go out much when the rain intensifies.' },
    ],
  },
  'البيت': {
    wordWithTashkeel: 'البَيْتُ',
    partOfSpeech: 'Noun',
    transliteration: 'al-bayt',
    englishMeaning: 'the house / home',
    examples: [
      { arabic: 'البَيْتُ الدَّافِئُ مَلْجَأٌ لِلرَّاحَةِ بَعْدَ يَوْمٍ طَوِيلٍ.', english: 'A warm home is a refuge for rest after a long day.' },
      { arabic: 'رَتَّبَ الأَطْفَالُ غُرَفَهُمْ قَبْلَ مُغَادَرَةِ البَيْتِ.', english: 'The children tidied their rooms before leaving the house.' },
    ],
  },
  'يمشي': {
    wordWithTashkeel: 'يَمْشِي',
    partOfSpeech: 'Verb (Present)',
    transliteration: 'yamshī',
    englishMeaning: 'he walks',
    examples: [
      { arabic: 'يَمْشِي الرَّجُلُ نِصْفَ سَاعَةٍ كُلَّ مَسَاءٍ لِلْحِفَاظِ عَلَى صِحَّتِهِ.', english: 'The man walks for half an hour every evening to maintain his health.' },
      { arabic: 'يَمْشِي القِطَارُ بِسُرْعَةٍ ثَابِتَةٍ عَبْرَ السُّهُولِ.', english: 'The train moves at a steady speed across the plains.' },
    ],
  },
  'السوق': {
    wordWithTashkeel: 'السُّوقُ',
    partOfSpeech: 'Noun',
    transliteration: 'as-sūq',
    englishMeaning: 'the market',
    examples: [
      { arabic: 'يَزْدَحِمُ السُّوقُ بِالمُتَسَوِّقِينَ قُبَيْلَ الأَعْيَادِ.', english: 'The market gets crowded with shoppers just before the holidays.' },
      { arabic: 'يَشْتَهَرُ هَذَا السُّوقُ بِالتَّوَابِلِ وَالحِرَفِ اليَدَوِيَّةِ.', english: 'This market is famous for spices and handicrafts.' },
    ],
  },
  'القديم': {
    wordWithTashkeel: 'القَدِيمُ',
    partOfSpeech: 'Adjective',
    transliteration: 'al-qadīm',
    englishMeaning: 'old / ancient',
    examples: [
      { arabic: 'زُرْنَا المَتْحَفَ القَدِيمَ فِي وَسَطِ المَدِينَةِ.', english: 'We visited the old museum in the center of the city.' },
      { arabic: 'يَحْتَفِظُ الكِتَابُ القَدِيمُ بِرَائِحَةِ الوَرَقِ وَالتَّارِيخِ.', english: 'The old book preserves the scent of paper and history.' },
    ],
  },
  'القريب': {
    wordWithTashkeel: 'القَرِيبُ',
    partOfSpeech: 'Adjective',
    transliteration: 'al-qarīb',
    englishMeaning: 'near / nearby',
    examples: [
      { arabic: 'تَقَعُ المَدْرَسَةُ فِي الشَّارِعِ القَرِيبِ مِنَ الحَدِيقَةِ.', english: 'The school is located on the street near the park.' },
      { arabic: 'أَتَمَنَّى لَكَ النَّجَاحَ فِي المُسْتَقْبَلِ القَرِيبِ.', english: 'I wish you success in the near future.' },
    ],
  },
  'الباعة': {
    wordWithTashkeel: 'البَاعَةُ',
    partOfSpeech: 'Noun (Plural)',
    transliteration: 'al-bāʿa',
    englishMeaning: 'the sellers / merchants',
    examples: [
      { arabic: 'يَعْرِضُ البَاعَةُ بَضَائِعَهُمْ بِتَرْتِيبٍ جَذَّابٍ فِي الصَّبَاحِ.', english: 'The merchants display their goods in an attractive arrangement in the morning.' },
      { arabic: 'يَتَعَامَلُ البَاعَةُ مَعَ الزَّبَائِنِ بِوُدٍّ وَابْتِسَامَةٍ.', english: 'The vendors deal with customers warmly and with a smile.' },
    ],
  },
  'يبتسمون': {
    wordWithTashkeel: 'يَبْتَسِمُونَ',
    partOfSpeech: 'Verb (Present, Plural)',
    transliteration: 'yabtasimūna',
    englishMeaning: 'they smile',
    examples: [
      { arabic: 'يَبْتَسِمُونَ عِنْدَمَا يَسْمَعُونَ قِصَصَ الطُّفُولَةِ الطَّرِيفَةَ.', english: 'They smile when they hear amusing childhood stories.' },
      { arabic: 'المُضِيفُونَ يَبْتَسِمُونَ دَائِمًا فِي وَجْهِ الضُّيُوفِ.', english: 'Hosts always smile at their guests.' },
    ],
  },
  'يرحبون': {
    wordWithTashkeel: 'يُرَحِّبُونَ',
    partOfSpeech: 'Verb (Present, Plural)',
    transliteration: 'yuraḥḥibūna',
    englishMeaning: 'they welcome',
    examples: [
      { arabic: 'أَهْلُ القَرْيَةِ يُرَحِّبُونَ بِكُلِّ زَائِرٍ يَأْتِي إِلَيْهِمْ.', english: 'The villagers welcome every visitor who comes to them.' },
      { arabic: 'يُرَحِّبُونَ بِالأَفْكَارِ الجَدِيدَةِ الَّتِي تَخْدِمُ المَشْرُوعَ.', english: 'They welcome new ideas that serve the project.' },
    ],
  },
  'دكان': {
    wordWithTashkeel: 'دُكَّانُ',
    partOfSpeech: 'Noun',
    transliteration: 'dukkān',
    englishMeaning: 'shop / small store',
    examples: [
      { arabic: 'يَفْتَحُ دُكَّانُ العِطَارَةِ أَبْوَابَهُ عِنْدَ السَّابِعَةِ صَبَاحًا.', english: 'The spice shop opens its doors at seven in the morning.' },
      { arabic: 'اِشْتَرَيْتُ دَفْتَرًا جَدِيدًا مِنْ دُكَّانِ الحَيِّ.', english: 'I bought a new notebook from the neighborhood shop.' },
    ],
  },
  'الفواكه': {
    wordWithTashkeel: 'الفَوَاكِهُ',
    partOfSpeech: 'Noun (Plural)',
    transliteration: 'al-fawākih',
    englishMeaning: 'fruits',
    examples: [
      { arabic: 'تَشْتَرِي الأُمُّ الفَوَاكِهَ الطَّازَجَةَ كُلَّ أُسْبُوعٍ.', english: 'The mother buys fresh fruits every week.' },
      { arabic: 'الفَوَاكِهُ الصَّيْفِيَّةُ غَنِيَّةٌ بِالفِيتَامِينَاتِ وَالمَاءِ.', english: 'Summer fruits are rich in vitamins and water.' },
    ],
  },
  'تفاح': {
    wordWithTashkeel: 'تُفَّاحٌ',
    partOfSpeech: 'Noun (Collective)',
    transliteration: 'tuffāḥ',
    englishMeaning: 'apples',
    examples: [
      { arabic: 'فِي السَّلَّةِ تُفَّاحٌ أَحْمَرُ وَأَخْضَرُ مِنَ البُسْتَانِ.', english: 'In the basket there are red and green apples from the orchard.' },
      { arabic: 'يُفَضِّلُ الصِّغَارُ عَصِيرَ التُّفَّاحِ الطَّبِيعِيَّ.', english: 'The young ones prefer natural apple juice.' },
    ],
  },
  'طازج': {
    wordWithTashkeel: 'طَازَجٌ',
    partOfSpeech: 'Adjective',
    transliteration: 'ṭāzaj',
    englishMeaning: 'fresh',
    examples: [
      { arabic: 'يُفَضِّلُ الطَّبَّاخُ اسْتِخْدَامَ الخُضَارِ الطَّازَجِ فِي الوَجَبَاتِ.', english: 'The chef prefers using fresh vegetables in meals.' },
      { arabic: 'هَذَا العَصِيرُ طَازَجٌ وَخَالٍ مِنَ السُّكَّرِ المُضَافِ.', english: 'This juice is fresh and free of added sugar.' },
    ],
  },
  'تمر': {
    wordWithTashkeel: 'تَمْرٌ',
    partOfSpeech: 'Noun',
    transliteration: 'tamr',
    englishMeaning: 'dates (fruit)',
    examples: [
      { arabic: 'يُقَدَّمُ التَّمْرُ مَعَ القَهْوَةِ العَرَبِيَّةِ عِنْدَ اسْتِقْبَالِ الضُّيُوفِ.', english: 'Dates are served with Arabic coffee when welcoming guests.' },
      { arabic: 'تَشْتَهِرُ الوَاحَاتُ بِإِنْتَاجِ تَمْرٍ فَاخِرٍ.', english: 'The oases are famous for producing fine dates.' },
    ],
  },
  'لذيذ': {
    wordWithTashkeel: 'لَذِيذٌ',
    partOfSpeech: 'Adjective',
    transliteration: 'ladhīdh',
    englishMeaning: 'delicious',
    examples: [
      { arabic: 'أَعَدَّتْ جَدَّتِي طَعَامًا لَذِيذًا لِاجْتِمَاعِ العَائِلَةِ.', english: 'My grandmother prepared a delicious meal for the family gathering.' },
      { arabic: 'العِنَبُ فِي هَذَا المَوْسِمِ حُلْوٌ وَلَذِيذٌ جِدًّا.', english: 'The grapes this season are very sweet and delicious.' },
    ],
  },
  'يشتري': {
    wordWithTashkeel: 'يَشْتَرِي',
    partOfSpeech: 'Verb (Present)',
    transliteration: 'yashtarī',
    englishMeaning: 'he buys',
    examples: [
      { arabic: 'يَشْتَرِي القَارِئُ كِتَابًا جَدِيدًا كُلَّ شَهْرٍ.', english: 'The reader buys a new book every month.' },
      { arabic: 'يَشْتَرِي المُهَنْدِسُ أَدَوَاتِ الرَّسْمِ مِنَ المَكْتَبَةِ.', english: 'The engineer buys drawing tools from the stationery store.' },
    ],
  },
  'الخبز': {
    wordWithTashkeel: 'الخُبْزُ',
    partOfSpeech: 'Noun',
    transliteration: 'al-khubz',
    englishMeaning: 'the bread',
    examples: [
      { arabic: 'أَحْضَرَ الوَالِدُ الخُبْزَ السَّاخِنَ مِنَ الفُرْنِ القَرِيبِ.', english: 'The father brought warm bread from the nearby bakery.' },
      { arabic: 'لَا تَخْلُو مَائِدَةُ الإِفْطَارِ مِنَ الخُبْزِ وَالزَّيْتُونِ.', english: 'The breakfast table is never without bread and olives.' },
    ],
  },
  'الدافئ': {
    wordWithTashkeel: 'الدَّافِئُ',
    partOfSpeech: 'Adjective',
    transliteration: 'ad-dāfiʾ',
    englishMeaning: 'warm',
    examples: [
      { arabic: 'المِعْطَفُ الدَّافِئُ يَحْمِي مِنَ البَرْدِ القَارِسِ.', english: 'The warm coat protects from the bitter cold.' },
      { arabic: 'أَعْطَانَا الاسْتِقْبَالُ الدَّافِئُ شُعُورًا بِالأُلْفَةِ.', english: 'The warm reception gave us a feeling of familiarity.' },
    ],
  },
  'العسل': {
    wordWithTashkeel: 'العَسَلُ',
    partOfSpeech: 'Noun',
    transliteration: 'al-ʿasal',
    englishMeaning: 'the honey',
    examples: [
      { arabic: 'يُضِيفُ بَعْضُ النَّاسِ العَسَلَ إِلَى الشَّايِ بَدَلًا مِنَ السُّكَّرِ.', english: 'Some people add honey to tea instead of sugar.' },
      { arabic: 'يُعْرَفُ العَسَلُ الجَبَلِيُّ بِجَوْدَتِهِ وَفَوَائِدِهِ الصِّحِّيَّةِ.', english: 'Mountain honey is known for its quality and health benefits.' },
    ],
  },
  'يعود': {
    wordWithTashkeel: 'يَعُودُ',
    partOfSpeech: 'Verb (Present)',
    transliteration: 'yaʿūdu',
    englishMeaning: 'he returns',
    examples: [
      { arabic: 'يَعُودُ الطُّلَّابُ إِلَى مَنَازِلِهِمْ بَعْدَ الظُّهْرِ.', english: 'The students return to their homes in the afternoon.' },
      { arabic: 'يَعُودُ الفَضْلُ فِي النَّجَاحِ إِلَى المُثَابَرَةِ.', english: 'Credit for success goes back to perseverance.' },
    ],
  },
  'مسرورا': {
    wordWithTashkeel: 'مَسْرُورًا',
    partOfSpeech: 'Adjective',
    transliteration: 'masrūran',
    englishMeaning: 'happy / delighted',
    examples: [
      { arabic: 'عَادَ الطِّفْلُ مِنَ الرِّحْلَةِ مَسْرُورًا بِمَا رَآهُ.', english: 'The child returned from the trip delighted with what he saw.' },
      { arabic: 'كَانَ الفَائِزُ مَسْرُورًا بِتَقْدِيرِ أَسَاتِذَتِهِ لِجُهْدِهِ.', english: 'The winner was pleased with his teachers’ appreciation of his effort.' },
    ],
  },

  // Lesson 2: Family Garden
  'تسكن': {
    wordWithTashkeel: 'تَسْكُنُ',
    partOfSpeech: 'Verb (Present, Feminine)',
    transliteration: 'taskunu',
    englishMeaning: 'she lives / resides',
    examples: [
      { arabic: 'تَسْكُنُ العَائِلَةُ فِي شَقَّةٍ تُطِلُّ عَلَى البَحْرِ.', english: 'The family lives in an apartment overlooking the sea.' },
      { arabic: 'تَسْكُنُ الرِّيَاحُ بَعْدَ مُنْتَصَفِ اللَّيْلِ.', english: 'The winds calm down after midnight.' },
    ],
  },
  'حديقة': {
    wordWithTashkeel: 'حَدِيقَةٌ',
    partOfSpeech: 'Noun',
    transliteration: 'ḥadīqa',
    englishMeaning: 'a garden / park',
    examples: [
      { arabic: 'فِي المَدِينَةِ حَدِيقَةٌ عَامَّةٌ يَتَنَزَّهُ فِيهَا السُّكَّانُ.', english: 'There is a public park in the city where residents stroll.' },
      { arabic: 'زَرَعْنَا شُجَيْرَاتِ الرُّمَّانِ فِي حَدِيقَةِ البَيْتِ.', english: 'We planted pomegranate saplings in the garden of the house.' },
    ],
  },
  'خضراء': {
    wordWithTashkeel: 'خَضْرَاءُ',
    partOfSpeech: 'Adjective (Feminine)',
    transliteration: 'khaḍrāʾ',
    englishMeaning: 'green',
    examples: [
      { arabic: 'تَمْتَدُّ الحُقُولُ الخَضْرَاءُ عَلَى ضِفَافِ النَّهْرِ.', english: 'The green fields stretch along the banks of the river.' },
      { arabic: 'أَوْرَاقُ الشَّجَرِ خَضْرَاءُ وَنَضِرَةٌ فِي فَصْلِ الرَّبِيعِ.', english: 'The tree leaves are green and vibrant in the spring season.' },
    ],
  },
  'واسعة': {
    wordWithTashkeel: 'وَاسِعَةٌ',
    partOfSpeech: 'Adjective (Feminine)',
    transliteration: 'wāsiʿa',
    englishMeaning: 'wide / spacious',
    examples: [
      { arabic: 'فِي المَكْتَبَةِ قَاعَةٌ وَاسِعَةٌ لِلْمُطَالَعَةِ وَالبَحْثِ.', english: 'In the library there is a spacious hall for reading and research.' },
      { arabic: 'تَمْتَلِكُ الأُسْتَاذَةُ خِبْرَةً وَاسِعَةً فِي تَعْلِيمِ اللُّغَاتِ.', english: 'The professor possesses wide experience in teaching languages.' },
    ],
  },
  'الاسرة': {
    wordWithTashkeel: 'الأُسْرَةُ',
    partOfSpeech: 'Noun',
    transliteration: 'al-usra',
    englishMeaning: 'the family',
    examples: [
      { arabic: 'تَتَعَاوَنُ الأُسْرَةُ فِي تَنْظِيمِ رِحْلَةِ نِهَايَةِ الأُسْبُوعِ.', english: 'The family cooperates in organizing the weekend trip.' },
      { arabic: 'الأُسْرَةُ المُتَمَاسِكَةُ تَدْعَمُ أَفْرَادَهَا فِي كُلِّ الظُّرُوفِ.', english: 'A close-knit family supports its members in all circumstances.' },
    ],
  },
  'الياسمين': {
    wordWithTashkeel: 'اليَاسَمِينُ',
    partOfSpeech: 'Noun',
    transliteration: 'al-yāsamīn',
    englishMeaning: 'the jasmine',
    examples: [
      { arabic: 'تَفُوحُ رَائِحَةُ اليَاسَمِينِ فِي أَزِقَّةِ دِمَشْقَ القَدِيمَةِ.', english: 'The scent of jasmine spreads through the alleys of old Damascus.' },
      { arabic: 'أَزْهَارُ اليَاسَمِينِ البَيْضَاءُ تَتَفَتَّحُ عِنْدَ الغُرُوبِ.', english: 'White jasmine flowers bloom at sunset.' },
    ],
  },
  'الازهار': {
    wordWithTashkeel: 'الأَزْهَارُ',
    partOfSpeech: 'Noun (Plural)',
    transliteration: 'al-azhār',
    englishMeaning: 'the flowers',
    examples: [
      { arabic: 'تَجْمَعُ النَّحْلَةُ الرَّحِيقَ مِنَ الأَزْهَارِ المُلَوَّنَةِ.', english: 'The bee gathers nectar from the colorful flowers.' },
      { arabic: 'يَعْتَنِي البُسْتَانِيُّ بِالأَزْهَارِ طَوَالَ العَامِ.', english: 'The gardener takes care of the flowers throughout the year.' },
    ],
  },
  'العذب': {
    wordWithTashkeel: 'العَذْبُ',
    partOfSpeech: 'Adjective',
    transliteration: 'al-ʿadhb',
    englishMeaning: 'fresh / sweet (water or speech)',
    examples: [
      { arabic: 'يَنْبُعُ المَاءُ العَذْبُ مِنْ قَلْبِ الجَبَلِ.', english: 'Fresh water springs from the heart of the mountain.' },
      { arabic: 'أَسَرَ الشَّاعِرُ الحُضُورَ بِكَلَامِهِ العَذْبِ.', english: 'The poet captivated the audience with his eloquent, sweet speech.' },
    ],
  },
  'يقرا': {
    wordWithTashkeel: 'يَقْرَأُ',
    partOfSpeech: 'Verb (Present)',
    transliteration: 'yaqraʾu',
    englishMeaning: 'he reads',
    examples: [
      { arabic: 'يَقْرَأُ البَاحِثُ مَقَالًا عِلْمِيًّا قَبْلَ كِتَابَةِ التَّقْرِيرِ.', english: 'The researcher reads a scientific article before writing the report.' },
      { arabic: 'يَقْرَأُ الأَبُ قِصَّةً قَصِيرَةً لِأَطْفَالِهِ كُلَّ لَيْلَةٍ.', english: 'The father reads a short story to his children every night.' },
    ],
  },
  'كتابا': {
    wordWithTashkeel: 'كِتَابًا',
    partOfSpeech: 'Noun',
    transliteration: 'kitāban',
    englishMeaning: 'a book',
    examples: [
      { arabic: 'اِسْتَعَرْتُ كِتَابًا نَادِرًا مِنْ مَكْتَبَةِ الجَامِعَةِ.', english: 'I borrowed a rare book from the university library.' },
      { arabic: 'أَلَّفَ الكَاتِبُ كِتَابًا عَنْ تَارِيخِ الخَطِّ العَرَبِيِّ.', english: 'The author wrote a book on the history of Arabic calligraphy.' },
    ],
  },
  'مفيدا': {
    wordWithTashkeel: 'مُفِيدًا',
    partOfSpeech: 'Adjective',
    transliteration: 'mufīdan',
    englishMeaning: 'useful / beneficial',
    examples: [
      { arabic: 'كَانَ الحِوَارُ مُفِيدًا لِجَمِيعِ الحَاضِرِينَ.', english: 'The discussion was beneficial for all attendees.' },
      { arabic: 'قَدَّمَ المُدَرِّبُ نَصِيحَةً وَدَرْسًا مُفِيدًا.', english: 'The coach offered advice and a useful lesson.' },
    ],
  },
  'السعادة': {
    wordWithTashkeel: 'السَّعَادَةُ',
    partOfSpeech: 'Noun',
    transliteration: 'as-saʿāda',
    englishMeaning: 'happiness',
    examples: [
      { arabic: 'تَكْمُنُ السَّعَادَةُ الحَقِيقِيَّةُ فِي القَنَاعَةِ وَالعَطَاءِ.', english: 'True happiness lies in contentment and generosity.' },
      { arabic: 'شَعَرَتِ الطَّالِبَةُ بِالسَّعَادَةِ عِنْدَ اسْتِلَامِ شَهَادَتِهَا.', english: 'The student felt happiness upon receiving her certificate.' },
    ],
  },
  'الهدوء': {
    wordWithTashkeel: 'الهُدُوءُ',
    partOfSpeech: 'Noun',
    transliteration: 'al-hudūʾ',
    englishMeaning: 'calmness / tranquility',
    examples: [
      { arabic: 'يَسُودُ الهُدُوءُ قَاعَةَ المَكْتَبَةِ طَوَالَ النَّهَارِ.', english: 'Quietness prevails in the library hall throughout the day.' },
      { arabic: 'يُعَالِجُ القَائِدُ الأَزَمَاتِ بِالهُدُوءِ وَالحِكْمَةِ.', english: 'The leader handles crises with calmness and wisdom.' },
    ],
  },

  // Lesson 3: House of Wisdom
  'الحكمة': {
    wordWithTashkeel: 'الحِكْمَةُ',
    partOfSpeech: 'Noun',
    transliteration: 'al-ḥikma',
    englishMeaning: 'wisdom',
    examples: [
      { arabic: 'تَأْتِي الحِكْمَةُ مِنَ التَّأَمُّلِ وَالتَّجَارِبِ الطَّوِيلَةِ.', english: 'Wisdom comes from reflection and long experiences.' },
      { arabic: 'سُمِّيَتْ دَارُ العِلْمِ فِي بَغْدَادَ بِبَيْتِ الحِكْمَةِ.', english: 'The center of learning in Baghdad was named the House of Wisdom.' },
    ],
  },
  'مركزا': {
    wordWithTashkeel: 'مَرْكَزًا',
    partOfSpeech: 'Noun',
    transliteration: 'markazan',
    englishMeaning: 'a center / hub',
    examples: [
      { arabic: 'أَصْبَحَتِ المَدِينَةُ مَرْكَزًا لِلتِّجَارَةِ وَالثَّقَافَةِ.', english: 'The city became a center for trade and culture.' },
      { arabic: 'اِفْتَتَحَتِ الجَامِعَةُ مَرْكَزًا جَدِيدًا لِلدِّرَاسَاتِ اللُّغَوِيَّةِ.', english: 'The university opened a new center for linguistic studies.' },
    ],
  },
  'بارزا': {
    wordWithTashkeel: 'بَارِزًا',
    partOfSpeech: 'Adjective',
    transliteration: 'bārizan',
    englishMeaning: 'prominent / distinguished',
    examples: [
      { arabic: 'لَعِبَ المُفَكِّرُ دَوْرًا بَارِزًا فِي تَطْوِيرِ المَنَاهِجِ.', english: 'The thinker played a prominent role in developing curricula.' },
      { arabic: 'يُعَدُّ هَذَا المَعْلَمُ أَثَرًا بَارِزًا فِي العِمَارَةِ الحَدِيثَةِ.', english: 'This landmark is considered a prominent monument in modern architecture.' },
    ],
  },
  'العلماء': {
    wordWithTashkeel: 'العُلَمَاءُ',
    partOfSpeech: 'Noun (Plural)',
    transliteration: 'al-ʿulamāʾ',
    englishMeaning: 'the scholars / scientists',
    examples: [
      { arabic: 'يَتَبَادَلُ العُلَمَاءُ الأَبْحَاثَ فِي المُؤْتَمَرِ الدَّوْلِيِّ.', english: 'Scientists exchange research at the international conference.' },
      { arabic: 'أَسْهَمَ العُلَمَاءُ فِي صِيَاغَةِ قَوَانِينِ الفَلَكِ وَالبَصَرِيَّاتِ.', english: 'Scholars contributed to formulating the laws of astronomy and optics.' },
    ],
  },
  'المترجمون': {
    wordWithTashkeel: 'المُتَرْجِمُونَ',
    partOfSpeech: 'Noun (Plural)',
    transliteration: 'al-mutarjimūna',
    englishMeaning: 'the translators',
    examples: [
      { arabic: 'نَقَلَ المُتَرْجِمُونَ نُصُوصَ الفَلْسَفَةِ وَالطِّبِّ إِلَى العَرَبِيَّةِ.', english: 'Translators rendered texts of philosophy and medicine into Arabic.' },
      { arabic: 'يَحْرِصُ المُتَرْجِمُونَ عَلَى أَمَانَةِ المَعْنَى وَجَمَالِ الأُسْلُوبِ.', english: 'Translators take care to preserve fidelity of meaning and elegance of style.' },
    ],
  },
  'المخطوطات': {
    wordWithTashkeel: 'المَخْطُوطَاتُ',
    partOfSpeech: 'Noun (Plural)',
    transliteration: 'al-makhṭūṭāt',
    englishMeaning: 'the manuscripts',
    examples: [
      { arabic: 'تَحْفَظُ المَكْتَبَةُ الوَطَنِيَّةُ آلَافَ المَخْطُوطَاتِ النَّادِرَةِ.', english: 'The national library preserves thousands of rare manuscripts.' },
      { arabic: 'يَدْرُسُ المُحَقِّقُونَ المَخْطُوطَاتِ لِلتَّأَكُّدِ مِنْ صِحَّةِ النُّصُوصِ.', english: 'Editors examine manuscripts to verify the accuracy of the texts.' },
    ],
  },
  'ابتكارات': {
    wordWithTashkeel: 'ابْتِكَارَاتٌ',
    partOfSpeech: 'Noun (Plural)',
    transliteration: 'ibtikārāt',
    englishMeaning: 'innovations / inventions',
    examples: [
      { arabic: 'أَثْمَرَ البَحْثُ العِلْمِيُّ عَنِ ابْتِكَارَاتٍ تَخْدِمُ البَشَرِيَّةَ.', english: 'Scientific research yielded innovations that serve humanity.' },
      { arabic: 'يَعْرِضُ المُهَنْدِسُونَ ابْتِكَارَاتٍ جَدِيدَةً فِي مَجَالِ الطَّاقَةِ.', english: 'Engineers present new innovations in the field of energy.' },
    ],
  },
  'المعرفة': {
    wordWithTashkeel: 'المَعْرِفَةُ',
    partOfSpeech: 'Noun',
    transliteration: 'al-maʿrifa',
    englishMeaning: 'knowledge',
    examples: [
      { arabic: 'القِرَاءَةُ هِيَ المِفْتَاحُ الأَسَاسِيُّ لِاِكْتِسَابِ المَعْرِفَةِ.', english: 'Reading is the fundamental key to acquiring knowledge.' },
      { arabic: 'تَتَرَاكَمُ المَعْرِفَةُ الإِنْسَانِيَّةُ جِيلًا بَعْدَ جِيلٍ.', english: 'Human knowledge accumulates generation after generation.' },
    ],
  },

  // Lesson 4: Coffee & Hospitality
  'الضيافة': {
    wordWithTashkeel: 'الضِّيَافَةُ',
    partOfSpeech: 'Noun',
    transliteration: 'aḍ-ḍiyāfa',
    englishMeaning: 'hospitality',
    examples: [
      { arabic: 'تُعَدُّ الضِّيَافَةُ مِنْ أَبْرَزِ القِيَمِ الاجْتِمَاعِيَّةِ فِي المِنْطَقَةِ.', english: 'Hospitality is considered one of the foremost social values in the region.' },
      { arabic: 'اِشْتُهِرَ الكُتَّابُ بِإِشَادَتِهِمْ بِحُسْنِ الضِّيَافَةِ العَرَبِيَّةِ.', english: 'Writers became known for praising the warmth of Arab hospitality.' },
    ],
  },
  'رمزا': {
    wordWithTashkeel: 'رَمْزًا',
    partOfSpeech: 'Noun',
    transliteration: 'ramzan',
    englishMeaning: 'a symbol',
    examples: [
      { arabic: 'يُعْتَبَرُ غُصْنُ الزَّيْتُونِ رَمْزًا لِلسَّلَامِ فِي الثَّقَافَاتِ كَافَّةً.', english: 'The olive branch is considered a symbol of peace across all cultures.' },
      { arabic: 'حَمَلَ القَلَمُ رَمْزًا لِلْعِلْمِ وَالتَّنْوِيرِ.', english: 'The pen served as a symbol of learning and enlightenment.' },
    ],
  },
  'الكرم': {
    wordWithTashkeel: 'الكَرَمُ',
    partOfSpeech: 'Noun',
    transliteration: 'al-karam',
    englishMeaning: 'generosity / nobility',
    examples: [
      { arabic: 'يُثْنِي النَّاسُ عَلَى كَرَمِهِ وَطِيبِ مَعْشَرِهِ.', english: 'People praise his generosity and pleasant company.' },
      { arabic: 'الكَرَمُ لَا يَقْتَصِرُ عَلَى المَالِ، بَلْ يَشْمَلُ حُسْنَ الخُلُقِ.', english: 'Generosity is not limited to wealth; it also includes good character.' },
    ],
  },
  'الضيف': {
    wordWithTashkeel: 'الضَّيْفُ',
    partOfSpeech: 'Noun',
    transliteration: 'aḍ-ḍayf',
    englishMeaning: 'the guest',
    examples: [
      { arabic: 'جَلَسَ الضَّيْفُ فِي صَدْرِ المَجْلِسِ مُحَاطًا بِالحَفَاوَةِ.', english: 'The guest sat at the head of the gathering surrounded by warmth.' },
      { arabic: 'قَدَّمَتِ العَائِلَةُ لِلضَّيْفِ التَّمْرَ وَالقَهْوَةَ.', english: 'The family offered dates and coffee to the guest.' },
    ],
  },
  'التقليد': {
    wordWithTashkeel: 'التَّقْلِيدُ',
    partOfSpeech: 'Noun',
    transliteration: 'at-taqlīd',
    englishMeaning: 'the tradition / custom',
    examples: [
      { arabic: 'حَافَظَ السُّكَّانُ عَلَى هَذَا التَّقْلِيدِ مُنْذُ مِئَاتِ السِّنِينَ.', english: 'The residents have preserved this tradition for hundreds of years.' },
      { arabic: 'يَعْكِسُ التَّقْلِيدُ الشَّعْبِيُّ ذَاكِرَةَ المُجْتَمَعِ وَتَارِيخَهُ.', english: 'Folk tradition reflects the memory and history of the society.' },
    ],
  },

  // Lesson 5: Language & Thought
  'اللغة': {
    wordWithTashkeel: 'اللُّغَةُ',
    partOfSpeech: 'Noun',
    transliteration: 'al-lugha',
    englishMeaning: 'the language',
    examples: [
      { arabic: 'تَنْمُو اللُّغَةُ بِاسْتِمْرَارٍ مَعَ تَطَوُّرِ العُلُومِ وَالفُنُونِ.', english: 'Language grows continuously with the development of sciences and arts.' },
      { arabic: 'تَعَلُّمُ اللُّغَةِ الأَجْنَبِيَّةِ يَفْتَحُ أَبْوَابًا لِلتَّفَاهُمِ الإِنْسَانِيِّ.', english: 'Learning a foreign language opens doors to human understanding.' },
    ],
  },
  'المفاهيم': {
    wordWithTashkeel: 'المَفَاهِيمُ',
    partOfSpeech: 'Noun (Plural)',
    transliteration: 'al-mafāhīm',
    englishMeaning: 'concepts / notions',
    examples: [
      { arabic: 'يُبَسِّطُ المُعَلِّمُ المَفَاهِيمَ المُعَقَّدَةَ بِأَمْثِلَةٍ وَاضِحَةٍ.', english: 'The teacher simplifies complex concepts with clear examples.' },
      { arabic: 'تَتَغَيَّرُ بَعْضُ المَفَاهِيمِ الفَلْسَفِيَّةِ عَبْرَ العُصُورِ.', english: 'Some philosophical concepts evolve across the ages.' },
    ],
  },
  'الاشتقاق': {
    wordWithTashkeel: 'الاشْتِقَاقُ',
    partOfSpeech: 'Noun',
    transliteration: 'al-ishtiqāq',
    englishMeaning: 'morphological derivation',
    examples: [
      { arabic: 'يُعَدُّ الاشْتِقَاقُ مِنْ أَهَمِّ وَسَائِلِ إِثْرَاءِ المُعْجَمِ العَرَبِيِّ.', english: 'Derivation is considered one of the most important means of enriching the Arabic lexicon.' },
      { arabic: 'يَدْرُسُ طُلَّابُ الصَّرْفِ قَوَاعِدَ الاشْتِقَاقِ مِنَ الجُذُورِ.', english: 'Morphology students study the rules of derivation from roots.' },
    ],
  },
  'الدلالات': {
    wordWithTashkeel: 'الدَّلَالَاتُ',
    partOfSpeech: 'Noun (Plural)',
    transliteration: 'ad-dalālāt',
    englishMeaning: 'meanings / connotations / significations',
    examples: [
      { arabic: 'تَحْمِلُ القَصِيدَةُ دَلَالَاتٍ رَمْزِيَّةً مُتَعَدِّدَةً.', english: 'The poem carries multiple symbolic connotations.' },
      { arabic: 'يَهْتَمُّ عِلْمُ اللُّغَةِ بِتَحْلِيلِ الدَّلَالَاتِ فِي السِّيَاقِ.', english: 'Linguistics is concerned with analyzing meanings in context.' },
    ],
  },

  // Lesson 6: Andalusian Architecture
  'يتجلي': {
    wordWithTashkeel: 'يَتَجَلَّى',
    partOfSpeech: 'Verb (Present)',
    transliteration: 'yatajallā',
    englishMeaning: 'it manifests / becomes clearly visible',
    examples: [
      { arabic: 'يَتَجَلَّى إِبْدَاعُ الفَنَّانِ فِي تَنَاسُقِ الأَلْوَانِ وَالظِّلَالِ.', english: 'The artist’s creativity manifests in the harmony of colors and shadows.' },
      { arabic: 'يَتَجَلَّى صِدْقُ الصَّدِيقِ فِي الأَوْقَاتِ الصَّعْبَةِ.', english: 'A friend’s sincerity becomes clear in difficult times.' },
    ],
  },
  'العمارة': {
    wordWithTashkeel: 'العِمَارَةُ',
    partOfSpeech: 'Noun',
    transliteration: 'al-ʿimāra',
    englishMeaning: 'architecture',
    examples: [
      { arabic: 'تَجْمَعُ العِمَارَةُ الإِسْلَامِيَّةُ بَيْنَ الجَمَالِ وَالوَظِيفَةِ.', english: 'Islamic architecture combines beauty and function.' },
      { arabic: 'يَدْرُسُ الطَّالِبُ تَارِيخَ العِمَارَةِ الكِلَاسِيكِيَّةِ.', english: 'The student studies the history of classical architecture.' },
    ],
  },
  'التامل': {
    wordWithTashkeel: 'التَّأَمُّلُ',
    partOfSpeech: 'Noun',
    transliteration: 'at-taʾammul',
    englishMeaning: 'contemplation / reflection',
    examples: [
      { arabic: 'يَمْنَحُ التَّأَمُّلُ فِي الطَّبِيعَةِ صَفَاءً لِلذِّهْنِ.', english: 'Contemplation of nature grants clarity to the mind.' },
      { arabic: 'قِرَاءَةُ الشِّعْرِ تَدْعُو إِلَى التَّأَمُّلِ العَمِيقِ.', english: 'Reading poetry invites deep contemplation.' },
    ],
  },
  'طمانينة': {
    wordWithTashkeel: 'طُمَأْنِينَةٌ',
    partOfSpeech: 'Noun',
    transliteration: 'ṭumaʾnīna',
    englishMeaning: 'serenity / peace of mind',
    examples: [
      { arabic: 'بَعَثَتْ كَلِمَاتُ الطَّبِيبِ طُمَأْنِينَةً فِي نَفْسِ المَرِيضِ.', english: 'The doctor’s words instilled peace of mind in the patient.' },
      { arabic: 'يَسْكُنُ القَلْبُ إِلَى طُمَأْنِينَةٍ عَمِيقَةٍ وَسَطَ الهُدُوءِ.', english: 'The heart settles into deep serenity amidst the quiet.' },
    ],
  },

  // Essential everyday vocabulary dictionary fallback
  'مكتبة': {
    wordWithTashkeel: 'مَكْتَبَة',
    partOfSpeech: 'Noun',
    transliteration: 'maktaba',
    englishMeaning: 'library / bookstore',
    examples: [
      { arabic: 'يَجْلِسُ الطَّالِبُ فِي المَكْتَبَةِ الهَادِئَةِ لِلْقِرَاءَةِ.', english: 'The student sits in the quiet library to read.' },
      { arabic: 'اشْتَرَيْتُ كِتَابًا جَدِيدًا مِنَ المَكْتَبَةِ القَرِيبَةِ.', english: 'I bought a new book from the nearby bookstore.' },
    ],
  },
  'مكتب': {
    wordWithTashkeel: 'مَكْتَب',
    partOfSpeech: 'Noun',
    transliteration: 'maktab',
    englishMeaning: 'desk / office',
    examples: [
      { arabic: 'وَضَعَتْ كِتَابَهَا عَلَى المَكْتَبِ الخَشَبِيِّ.', english: 'She placed her book on the wooden desk.' },
      { arabic: 'يَعْمَلُ المُهَنْدِسُ فِي مَكْتَبٍ هَادِئٍ وَمُنَظَّمٍ.', english: 'The engineer works in a quiet and organized office.' },
    ],
  },
  'كتاب': {
    wordWithTashkeel: 'كِتَاب',
    partOfSpeech: 'Noun',
    transliteration: 'kitāb',
    englishMeaning: 'book',
    examples: [
      { arabic: 'قَرَأْتُ كِتَابًا مُمْتِعًا عَنِ التَّارِيخِ العَرَبِيِّ.', english: 'I read an enjoyable book about Arab history.' },
      { arabic: 'هَذَا الكِتَابُ مُفِيدٌ لِطُلَّابِ اللُّغَةِ العَرَبِيَّةِ.', english: 'This book is useful for students of the Arabic language.' },
    ],
  },
  'مدرسة': {
    wordWithTashkeel: 'مَدْرَسَة',
    partOfSpeech: 'Noun',
    transliteration: 'madrasa',
    englishMeaning: 'school',
    examples: [
      { arabic: 'يَذْهَبُ التَّلَامِيذُ إِلَى المَدْرَسَةِ كُلَّ صَبَاحٍ.', english: 'The pupils go to school every morning.' },
      { arabic: 'تَقَعُ المَدْرَسَةُ بِالقُرْبِ مِنَ الحَدِيقَةِ العَامَّةِ.', english: 'The school is located near the public park.' },
    ],
  },
  'جامعة': {
    wordWithTashkeel: 'جَامِعَة',
    partOfSpeech: 'Noun',
    transliteration: 'jāmiʿa',
    englishMeaning: 'university',
    examples: [
      { arabic: 'يَدْرُسُ أَخِي الأَدَبَ العَرَبِيَّ فِي الجَامِعَةِ.', english: 'My brother studies Arabic literature at the university.' },
      { arabic: 'تَضُمُّ الجَامِعَةُ مَكْتَبَةً كَبِيرَةً لِلْبَحْثِ العِلْمِيِّ.', english: 'The university includes a large library for scientific research.' },
    ],
  },
  'طالب': {
    wordWithTashkeel: 'طَالِب',
    partOfSpeech: 'Noun',
    transliteration: 'ṭālib',
    englishMeaning: 'student',
    examples: [
      { arabic: 'يَسْأَلُ الطَّالِبُ المُعَلِّمَ عَنْ مَعْنَى الكَلِمَةِ.', english: 'The student asks the teacher about the meaning of the word.' },
      { arabic: 'اجْتَهَدَ الطَّالِبُ فِي دُرُوسِهِ طَوَالَ الفَصْلِ.', english: 'The student worked diligently on his lessons throughout the term.' },
    ],
  },
  'معلم': {
    wordWithTashkeel: 'مُعَلِّم',
    partOfSpeech: 'Noun',
    transliteration: 'muʿallim',
    englishMeaning: 'teacher / instructor',
    examples: [
      { arabic: 'شَرَحَ المُعَلِّمُ القَاعِدَةَ النَّحْوِيَّةَ بِوُضُوحٍ.', english: 'The teacher explained the grammar rule clearly.' },
      { arabic: 'يَحْتَرِمُ الطُّلَّابُ المُعَلِّمَ المُخْلِصَ فِي عَمَلِهِ.', english: 'The students respect the teacher who is dedicated to his work.' },
    ],
  },
  'قلم': {
    wordWithTashkeel: 'قَلَم',
    partOfSpeech: 'Noun',
    transliteration: 'qalam',
    englishMeaning: 'pen',
    examples: [
      { arabic: 'كَتَبَتِ الطَّالِبَةُ الدَّرْسَ بِقَلَمٍ أَزْرَقَ.', english: 'The student wrote the lesson with a blue pen.' },
      { arabic: 'القَلَمُ وَالدَّفْتَرُ مِنْ أَهَمِّ أَدَوَاتِ الكِتَابَةِ.', english: 'The pen and the notebook are among the most important writing tools.' },
    ],
  },
  'مدينة': {
    wordWithTashkeel: 'مَدِينَة',
    partOfSpeech: 'Noun',
    transliteration: 'madīna',
    englishMeaning: 'city / town',
    examples: [
      { arabic: 'تَشْتَهِرُ المَدِينَةُ بِأَسْوَاقِهَا التَّقْلِيدِيَّةِ وَمَتَاحِفِهَا.', english: 'The city is famous for its traditional markets and museums.' },
      { arabic: 'سَافَرْنَا إِلَى مَدِينَةٍ سَاحِلِيَّةٍ فِي العُطْلَةِ.', english: 'We traveled to a coastal city during the holiday.' },
    ],
  },
  'قرية': {
    wordWithTashkeel: 'قَرْيَة',
    partOfSpeech: 'Noun',
    transliteration: 'qarya',
    englishMeaning: 'village',
    examples: [
      { arabic: 'تَتَمَيَّزُ القَرْيَةُ بِالهُدُوءِ وَالهَوَاءِ النَّقِيِّ.', english: 'The village is characterized by calm and fresh air.' },
      { arabic: 'زُرْنَا قَرْيَةً جَمِيلَةً بَيْنَ الجِبَالِ الخَضْرَاءِ.', english: 'We visited a beautiful village among the green mountains.' },
    ],
  },
  'صديق': {
    wordWithTashkeel: 'صَدِيق',
    partOfSpeech: 'Noun',
    transliteration: 'ṣadīq',
    englishMeaning: 'friend',
    examples: [
      { arabic: 'التَقَيْتُ بِصَدِيقٍ قَدِيمٍ فِي المَقْهَى اليَوْمَ.', english: 'I met an old friend at the café today.' },
      { arabic: 'الصَّدِيقُ الصَّادِقُ يَقِفُ بِجَانِبِكَ دَائِمًا.', english: 'A true friend always stands by your side.' },
    ],
  },
  'ماء': {
    wordWithTashkeel: 'مَاء',
    partOfSpeech: 'Noun',
    transliteration: 'māʾ',
    englishMeaning: 'water',
    examples: [
      { arabic: 'شَرِبَ الرَّحَّالَةُ كُوبًا مِنَ المَاءِ البَارِدِ.', english: 'The traveler drank a glass of cold water.' },
      { arabic: 'المَاءُ النَّقِيُّ أَسَاسُ الحَيَاةِ عَلَى الأَرْضِ.', english: 'Pure water is the foundation of life on earth.' },
    ],
  },
  'طعام': {
    wordWithTashkeel: 'طَعَام',
    partOfSpeech: 'Noun',
    transliteration: 'ṭaʿām',
    englishMeaning: 'food / meal',
    examples: [
      { arabic: 'أَعَدَّتِ الأُسْرَةُ طَعَامًا شَهِيًّا لِلضُّيُوفِ.', english: 'The family prepared delicious food for the guests.' },
      { arabic: 'يَجْتَمِعُ الأَهْلُ حَوْلَ مَائِدَةِ الطَّعَامِ مَسَاءً.', english: 'The family gathers around the dining table in the evening.' },
    ],
  },
  'عمل': {
    wordWithTashkeel: 'عَمَل',
    partOfSpeech: 'Noun',
    transliteration: 'ʿamal',
    englishMeaning: 'work / job / deed',
    examples: [
      { arabic: 'أَنْهَى المُوَظَّفُ عَمَلَهُ فِي الوَقْتِ المُحَدَّدِ.', english: 'The employee finished his work on time.' },
      { arabic: 'العَمَلُ الجَمَاعِيُّ يُحَقِّقُ نَتَائِجَ أَفْضَلَ.', english: 'Teamwork achieves better results.' },
    ],
  },
  'علم': {
    wordWithTashkeel: 'عِلْم',
    partOfSpeech: 'Noun',
    transliteration: 'ʿilm',
    englishMeaning: 'knowledge / science',
    examples: [
      { arabic: 'طَلَبُ العِلْمِ رِحْلَةٌ مُمْتِعَةٌ مَدَى الحَيَاةِ.', english: 'Seeking knowledge is an enjoyable lifelong journey.' },
      { arabic: 'سَاهَمَ العِلْمُ الحَدِيثُ فِي تَطْوِيرِ الطِّبِّ.', english: 'Modern science contributed to advancing medicine.' },
    ],
  },
  'كلمة': {
    wordWithTashkeel: 'كَلِمَة',
    partOfSpeech: 'Noun',
    transliteration: 'kalima',
    englishMeaning: 'word / speech',
    examples: [
      { arabic: 'تَعَلَّمْتُ كَلِمَةً عَرَبِيَّةً جَدِيدَةً هَذَا الصَّبَاحَ.', english: 'I learned a new Arabic word this morning.' },
      { arabic: 'الكَلِمَةُ الطَّيِّبَةُ تَتْرُكُ أَثَرًا جَمِيلًا فِي النَّفْسِ.', english: 'A kind word leaves a beautiful impression on the soul.' },
    ],
  },
  'قصة': {
    wordWithTashkeel: 'قِصَّة',
    partOfSpeech: 'Noun',
    transliteration: 'qiṣṣa',
    englishMeaning: 'story / tale',
    examples: [
      { arabic: 'قَرَأَ الأَطْفَالُ قِصَّةً قَصِيرَةً قَبْلَ النَّوْمِ.', english: 'The children read a short story before sleep.' },
      { arabic: 'تَحْمِلُ القِصَّةُ حِكْمَةً وَعِبْرَةً جَمِيلَةً.', english: 'The story carries wisdom and a beautiful moral.' },
    ],
  },
  'يوم': {
    wordWithTashkeel: 'يَوْم',
    partOfSpeech: 'Noun',
    transliteration: 'yawm',
    englishMeaning: 'day',
    examples: [
      { arabic: 'يَبْدَأُ يَوْمُ الدِّرَاسَةِ فِي السَّاعَةِ الثَّامِنَةِ.', english: 'The study day begins at eight o’clock.' },
      { arabic: 'نَقْرَأُ صَفْحَةً وَاحِدَةً كُلَّ يَوْمٍ.', english: 'We read one page every day.' },
    ],
  },
  'سلام': {
    wordWithTashkeel: 'سَلَام',
    partOfSpeech: 'Noun',
    transliteration: 'salām',
    englishMeaning: 'peace / greeting',
    examples: [
      { arabic: 'يَسْعَى النَّاسُ دَائِمًا إِلَى العَيْشِ فِي سَلَامٍ وَأَمَانٍ.', english: 'People always strive to live in peace and security.' },
      { arabic: 'بَدَأَ اللِّقَاءُ بِتَحِيَّةِ السَّلَامِ وَالابْتِسَامَةِ.', english: 'The meeting began with a greeting of peace and a smile.' },
    ],
  },
  'جميل': {
    wordWithTashkeel: 'جَمِيل',
    partOfSpeech: 'Adjective',
    transliteration: 'jamīl',
    englishMeaning: 'beautiful / lovely',
    examples: [
      { arabic: 'هَذَا مَنْظَرٌ طَبِيعِيٌّ جَمِيلٌ عِنْدَ الغُرُوبِ.', english: 'This is a beautiful natural view at sunset.' },
      { arabic: 'كَتَبَ الخَطَّاطُ عِبَارَةً بِخَطٍّ عَرَبِيٍّ جَمِيلٍ.', english: 'The calligrapher wrote a phrase in beautiful Arabic script.' },
    ],
  },
  'كبير': {
    wordWithTashkeel: 'كَبِير',
    partOfSpeech: 'Adjective',
    transliteration: 'kabīr',
    englishMeaning: 'big / large / great',
    examples: [
      { arabic: 'تَمْتَلِكُ المَدِينَةُ مَتْحَفًا كَبِيرًا لِلْفُنُونِ.', english: 'The city has a large museum for the arts.' },
      { arabic: 'أَظْهَرَ الطَّالِبُ اهْتِمَامًا كَبِيرًا بِالتَّارِيخِ.', english: 'The student showed great interest in history.' },
    ],
  },
  'جديد': {
    wordWithTashkeel: 'جَدِيد',
    partOfSpeech: 'Adjective',
    transliteration: 'jadīd',
    englishMeaning: 'new / fresh',
    examples: [
      { arabic: 'بَدَأْنَا اليَوْمَ دَرْسًا جَدِيدًا فِي القِرَاءَةِ.', english: 'Today we started a new lesson in reading.' },
      { arabic: 'هَذَا الأُسْلُوبُ الجَدِيدُ يُسَاعِدُ عَلَى الحِفْظِ.', english: 'This new method helps with memorization.' },
    ],
  },
  'قرا': {
    wordWithTashkeel: 'قَرَأَ',
    partOfSpeech: 'Verb (Past)',
    transliteration: 'qaraʾa',
    englishMeaning: 'he read / recited',
    examples: [
      { arabic: 'قَرَأَ الطَّالِبُ النَّصَّ بِصَوْتٍ وَاضِحٍ.', english: 'The student read the passage in a clear voice.' },
      { arabic: 'قَرَأَ البَاحِثُ مَخْطُوطَاتٍ نَادِرَةً فِي المَكْتَبَةِ.', english: 'The researcher read rare manuscripts in the library.' },
    ],
  },
  'كتب': {
    wordWithTashkeel: 'كَتَبَ',
    partOfSpeech: 'Verb (Past)',
    transliteration: 'kataba',
    englishMeaning: 'he wrote',
    examples: [
      { arabic: 'كَتَبَ المُؤَلِّفُ رِوَايَةً مَشْهُورَةً.', english: 'The author wrote a famous novel.' },
      { arabic: 'كَتَبَ التِّلْمِيذُ الكَلِمَاتِ الجَدِيدَةَ فِي دَفْتَرِهِ.', english: 'The pupil wrote the new words in his notebook.' },
    ],
  },
  'ذهب': {
    wordWithTashkeel: 'ذَهَبَ',
    partOfSpeech: 'Verb (Past)',
    transliteration: 'dhahaba',
    englishMeaning: 'he went',
    examples: [
      { arabic: 'ذَهَبَ الأَصْدِقَاءُ إِلَى المَكْتَبَةِ بَعْدَ الظُّهْرِ.', english: 'The friends went to the library in the afternoon.' },
      { arabic: 'ذَهَبَ المُسَافِرُ إِلَى المَطَارِ مُبَكِّرًا.', english: 'The traveler went to the airport early.' },
    ],
  },
  'مرحبا': {
    wordWithTashkeel: 'مَرْحَبًا',
    partOfSpeech: 'Expression',
    transliteration: 'marḥaban',
    englishMeaning: 'hello / welcome',
    examples: [
      { arabic: 'مَرْحَبًا بِكُمْ فِي دَرْسِ اللُّغَةِ العَرَبِيَّةِ.', english: 'Welcome to the Arabic language lesson.' },
      { arabic: 'قَالَ لَهُمُ المُضِيفُ: مَرْحَبًا بِالضُّيُوفِ الكِرَامِ.', english: 'The host said to them: Welcome, honored guests.' },
    ],
  },
  'شكرا': {
    wordWithTashkeel: 'شُكْرًا',
    partOfSpeech: 'Expression',
    transliteration: 'shukran',
    englishMeaning: 'thank you',
    examples: [
      { arabic: 'شُكْرًا جَزِيلًا عَلَى مُسَاعَدَتِكَ الكَرِيمَةِ.', english: 'Thank you very much for your kind help.' },
      { arabic: 'قَالَ الطَّالِبُ لِمُعَلِّمِهِ: شُكْرًا عَلَى الشَّرْحِ.', english: 'The student said to his teacher: Thank you for the explanation.' },
    ],
  },
};

const LEXICON_WORD_META: Record<string, { wordType: string; root: string }> = {
  'في': { wordType: 'حرف', root: '' },
  'من': { wordType: 'حرف', root: '' },
  'الي': { wordType: 'حرف', root: '' },
  'علي': { wordType: 'حرف', root: '' },
  'مع': { wordType: 'ظرف', root: '' },
  'ثم': { wordType: 'حرف', root: '' },
  'كان': { wordType: 'فعل', root: 'ك - و - ن' },
  'يستيقظ': { wordType: 'فعل', root: 'ي - ق - ظ' },
  'كريم': { wordType: 'اسم', root: 'ك - ر - م' },
  'مبكرا': { wordType: 'ظرف', root: 'ب - ك - ر' },
  'الصباح': { wordType: 'اسم', root: 'ص - ب - ح' },
  'الباكر': { wordType: 'صفة', root: 'ب - ك - ر' },
  'يشرب': { wordType: 'فعل', root: 'ش - ر - ب' },
  'فنجانا': { wordType: 'اسم', root: 'ف - ن - ج - ن' },
  'القهوة': { wordType: 'اسم', root: 'ق - ه - و' },
  'الساخنة': { wordType: 'صفة', root: 'س - خ - ن' },
  'يخرج': { wordType: 'فعل', root: 'خ - ر - ج' },
  'البيت': { wordType: 'اسم', root: 'ب - ي - ت' },
  'يمشي': { wordType: 'فعل', root: 'م - ش - ي' },
  'السوق': { wordType: 'اسم', root: 'س - و - ق' },
  'القديم': { wordType: 'صفة', root: 'ق - د - م' },
  'القريب': { wordType: 'صفة', root: 'ق - ر - ب' },
  'الباعة': { wordType: 'اسم', root: 'ب - ي - ع' },
  'يبتسمون': { wordType: 'فعل', root: 'ب - س - م' },
  'يرحبون': { wordType: 'فعل', root: 'ر - ح - ب' },
  'دكان': { wordType: 'اسم', root: 'د - ك - ن' },
  'الفواكه': { wordType: 'اسم', root: 'ف - ك - ه' },
  'تفاح': { wordType: 'اسم', root: 'ت - ف - ح' },
  'طازج': { wordType: 'صفة', root: 'ط - ز - ج' },
  'تمر': { wordType: 'اسم', root: 'ت - م - ر' },
  'لذيذ': { wordType: 'صفة', root: 'ل - ذ - ذ' },
  'يشتري': { wordType: 'فعل', root: 'ش - ر - ي' },
  'الخبز': { wordType: 'اسم', root: 'خ - ب - ز' },
  'الدافئ': { wordType: 'صفة', root: 'د - ف - أ' },
  'العسل': { wordType: 'اسم', root: 'ع - س - ل' },
  'يعود': { wordType: 'فعل', root: 'ع - و - د' },
  'مسرورا': { wordType: 'صفة', root: 'س - ر - ر' },
  'تسكن': { wordType: 'فعل', root: 'س - ك - ن' },
  'حديقة': { wordType: 'اسم', root: 'ح - د - ق' },
  'خضراء': { wordType: 'صفة', root: 'خ - ض - ر' },
  'واسعة': { wordType: 'صفة', root: 'و - س - ع' },
  'الاسرة': { wordType: 'اسم', root: 'أ - س - ر' },
  'الياسمين': { wordType: 'اسم', root: 'ي - س - م' },
  'الازهار': { wordType: 'اسم', root: 'ز - ه - ر' },
  'العذب': { wordType: 'صفة', root: 'ع - ذ - ب' },
  'يقرا': { wordType: 'فعل', root: 'ق - ر - أ' },
  'كتابا': { wordType: 'اسم', root: 'ك - ت - ب' },
  'مفيدا': { wordType: 'صفة', root: 'ف - ي - د' },
  'السعادة': { wordType: 'اسم', root: 'س - ع - د' },
  'الهدوء': { wordType: 'اسم', root: 'ه - د - أ' },
  'الحكمة': { wordType: 'اسم', root: 'ح - ك - م' },
  'مركزا': { wordType: 'اسم', root: 'ر - ك - ز' },
  'بارزا': { wordType: 'صفة', root: 'ب - ر - ز' },
  'العلماء': { wordType: 'اسم', root: 'ع - ل - م' },
  'المترجمون': { wordType: 'اسم', root: 'ت - ر - ج - م' },
  'المخطوطات': { wordType: 'اسم', root: 'خ - ط - ط' },
  'ابتكارات': { wordType: 'اسم', root: 'ب - ك - ر' },
  'المعرفة': { wordType: 'اسم', root: 'ع - ر - ف' },
  'الضيافة': { wordType: 'اسم', root: 'ض - ي - ف' },
  'رمزا': { wordType: 'اسم', root: 'ر - م - ز' },
  'الكرم': { wordType: 'اسم', root: 'ك - ر - م' },
  'الضيف': { wordType: 'اسم', root: 'ض - ي - ف' },
  'التقليد': { wordType: 'اسم', root: 'ق - ل - د' },
  'اللغة': { wordType: 'اسم', root: 'ل - غ - و' },
  'المفاهيم': { wordType: 'اسم', root: 'ف - ه - م' },
  'الاشتقاق': { wordType: 'اسم', root: 'ش - ق - ق' },
  'الدلالات': { wordType: 'اسم', root: 'د - ل - ل' },
  'يتجلي': { wordType: 'فعل', root: 'ج - ل - و' },
  'العمارة': { wordType: 'اسم', root: 'ع - م - ر' },
  'التامل': { wordType: 'اسم', root: 'أ - م - ل' },
  'طمانينة': { wordType: 'اسم', root: 'ط - م - أ - ن' },
  'مكتبة': { wordType: 'اسم', root: 'ك - ت - ب' },
  'مكتب': { wordType: 'اسم', root: 'ك - ت - ب' },
  'كتاب': { wordType: 'اسم', root: 'ك - ت - ب' },
  'مدرسة': { wordType: 'اسم', root: 'د - ر - س' },
  'جامعة': { wordType: 'اسم', root: 'ج - م - ع' },
  'طالب': { wordType: 'اسم', root: 'ط - ل - ب' },
  'معلم': { wordType: 'اسم', root: 'ع - ل - م' },
  'قلم': { wordType: 'اسم', root: 'ق - ل - م' },
  'مدينة': { wordType: 'اسم', root: 'م - د - ن' },
  'قرية': { wordType: 'اسم', root: 'ق - ر - ي' },
  'صديق': { wordType: 'اسم', root: 'ص - د - ق' },
  'ماء': { wordType: 'اسم', root: 'م - و - ه' },
  'طعام': { wordType: 'اسم', root: 'ط - ع - م' },
  'عمل': { wordType: 'اسم', root: 'ع - م - ل' },
  'علم': { wordType: 'اسم', root: 'ع - ل - م' },
  'كلمة': { wordType: 'اسم', root: 'ك - ل - م' },
  'قصة': { wordType: 'اسم', root: 'ق - ص - ص' },
  'يوم': { wordType: 'اسم', root: 'ي - و - م' },
  'سلام': { wordType: 'اسم', root: 'س - ل - م' },
  'جميل': { wordType: 'صفة', root: 'ج - م - ل' },
  'كبير': { wordType: 'صفة', root: 'ك - ب - ر' },
  'جديد': { wordType: 'صفة', root: 'ج - د - د' },
  'قرا': { wordType: 'فعل', root: 'ق - ر - أ' },
  'كتب': { wordType: 'فعل', root: 'ك - ت - ب' },
  'ذهب': { wordType: 'فعل', root: 'ذ - ه - ب' },
  'مرحبا': { wordType: 'اسم', root: 'ر - ح - ب' },
  'شكرا': { wordType: 'اسم', root: 'ش - ك - ر' },
};

function stripCommonPrefixes(normalized: string): string[] {
  const candidates = [normalized];
  const prefixes = ['وال', 'بال', 'كال', 'فال', 'لل', 'ال', 'و', 'ب', 'ل', 'ف', 'ك'];
  for (const prefix of prefixes) {
    if (normalized.startsWith(prefix) && normalized.length - prefix.length >= 2) {
      candidates.push(normalized.slice(prefix.length));
    }
  }
  return candidates;
}

export function findExactLexiconMatch(rawWord: string): LexiconEntry | null {
  const normalized = normalizeArabicWord(rawWord.trim());
  const standalone = normalizeStandaloneArabicKey(rawWord.trim());
  const candidates = [
    ...new Set([
      ...stripCommonPrefixes(normalized),
      ...stripCommonPrefixes(standalone),
      `${standalone}ا`,
    ]),
  ];

  for (const candidate of candidates) {
    const match = RAW_LEXICON[candidate];
    if (match) {
      const meta = LEXICON_WORD_META[candidate];
      return {
        ...match,
        wordType: meta?.wordType ?? inferArabicWordType(match.partOfSpeech),
        root: meta?.root ?? '',
      };
    }
  }

  for (const base of new Set([normalized, standalone])) {
    const withAlKey = `ال${base}`;
    const withAl = RAW_LEXICON[withAlKey];
    if (withAl) {
      const meta = LEXICON_WORD_META[withAlKey];
      return {
        ...withAl,
        wordType: meta?.wordType ?? inferArabicWordType(withAl.partOfSpeech),
        root: meta?.root ?? '',
      };
    }
  }

  return null;
}

export function enrichWordMeta(
  rawWord: string,
  partOfSpeech?: string,
  existingWordType?: string,
  existingRoot?: string
): { wordType: string; root: string } {
  const exact = findExactLexiconMatch(rawWord);
  const wordType = existingWordType?.trim()
    ? inferArabicWordType(existingWordType)
    : exact?.wordType || inferArabicWordType(partOfSpeech);
  const normalizedRoot = formatMinimalArabicRoot(existingRoot);
  const root = normalizedRoot || (exact?.root ? formatMinimalArabicRoot(exact.root) : '');
  return { wordType, root };
}

export function getLexiconSpeechText(
  rawWord: string,
  fallbackWordWithTashkeel?: string,
  wordType?: string,
  partOfSpeech?: string
): string {
  const exact = findExactLexiconMatch(rawWord || fallbackWordWithTashkeel || '');
  const richSource = exact?.wordWithTashkeel || fallbackWordWithTashkeel || rawWord;
  return stripFinalIrabForSpeech(richSource, {
    wordType: wordType || exact?.wordType,
    partOfSpeech: partOfSpeech || exact?.partOfSpeech,
  });
}

function buildLevelFallbackExamples(
  displayWord: string,
  cleanMeaning: string,
  wordType: string,
  contextSentence: string | undefined,
  level: ProficiencyLevel
): SentencePair[] {
  const cleanContext = contextSentence?.trim()
    ? applySmartPartialTashkeel(contextSentence.trim())
    : '';
  const pausalWord = stripFinalIrabForSpeech(displayWord, { wordType });
  const bareWord = applySmartPartialTashkeel(pausalWord.replace(/\u0652$/u, ''));

  if (level === 'beginner') {
    const simpleTemplates: Record<string, SentencePair> = {
      فعل: {
        arabic: applySmartPartialTashkeel(`الطّالبُ ${displayWord} كلَّ يومٍ.`),
        english: `The student uses this action (${cleanMeaning}) every day.`,
        contextLabel: 'Beginner · Simple Daily Use',
      },
      صفة: {
        arabic: applySmartPartialTashkeel(`هَذا الشّيْءُ ${displayWord} جِدًّا.`),
        english: `This thing is very (${cleanMeaning}).`,
        contextLabel: 'Beginner · Simple Daily Use',
      },
      حرف: {
        arabic: applySmartPartialTashkeel(`الكتابُ ${displayWord} الطّاولةِ في الغرفةِ.`),
        english: `Simple everyday sentence using "${pausalWord}" (${cleanMeaning}).`,
        contextLabel: 'Beginner · Simple Daily Use',
      },
    };
    const primary = simpleTemplates[wordType] ?? {
      arabic: applySmartPartialTashkeel(`أحبُّ ${displayWord} في بيتي.`),
      english: `I like ${cleanMeaning} in my home.`,
      contextLabel: 'Beginner · Simple Daily Use',
    };

    const secondary: SentencePair =
      cleanContext && countArabicWords(cleanContext) <= 9
        ? {
            arabic: cleanContext,
            english: 'From your Beginner reading passage.',
            contextLabel: 'Lesson Context',
          }
        : {
            arabic: applySmartPartialTashkeel(`نرى ${displayWord} في الصّباحِ.`),
            english: `We see ${cleanMeaning} in the morning.`,
            contextLabel: 'Beginner · Everyday Context',
          };

    return [primary, secondary];
  }

  if (level === 'advanced') {
    const primary: SentencePair =
      wordType === 'فعل'
        ? {
            arabic: applySmartPartialTashkeel(
              `حِينَ ${displayWord} الإِنسانُ فِي قَضايا الفِكْرِ، يَتَجَلَّى عُمْقُ الرُّؤْيَةِ وَسَعَةُ الأُفُقِ.`
            ),
            english: `When one engages deeply with ideas (${cleanMeaning}), depth of vision and breadth of horizon become clear.`,
            contextLabel: 'Advanced · Literary Discourse',
          }
        : wordType === 'صفة'
          ? {
              arabic: applySmartPartialTashkeel(
                `يَتَّسِمُ هَذا الأُسْلُوبُ البَلاغِيُّ بِطابَعٍ ${displayWord} يَجْذِبُ القارِئَ المتأمِّلَ.`
              ),
              english: `This rhetorical style is characterized by a (${cleanMeaning}) quality that captivates the thoughtful reader.`,
              contextLabel: 'Advanced · Nuanced Expression',
            }
          : {
              arabic: applySmartPartialTashkeel(
                `تُعَدُّ فِكْرَةُ «${bareWord}» رَكِيزَةً أَساسِيَّةً فِي صِياغَةِ الوَعْيِ الثَّقافِيِّ المعاصِرِ.`
              ),
              english: `The concept of "${cleanMeaning}" is considered a fundamental pillar in shaping contemporary cultural awareness.`,
              contextLabel: 'Advanced · Literary & Media Use',
            };

    const secondary: SentencePair =
      cleanContext && countArabicWords(cleanContext) >= 8
        ? {
            arabic: cleanContext,
            english: 'Original sentence from your Advanced reading passage.',
            contextLabel: 'Passage Context',
          }
        : {
            arabic: applySmartPartialTashkeel(
              `لا غِنَى عَنْ تَوْظِيفِ «${bareWord}» فِي الحِوارِ الفِكْرِيِّ الرَّصِينِ.`
            ),
            english: `Employing "${cleanMeaning}" is indispensable in well-crafted intellectual dialogue.`,
            contextLabel: 'Advanced · Idiomatic Context',
          };

    return [primary, secondary];
  }

  // Intermediate
  const primary: SentencePair =
    wordType === 'فعل'
      ? {
          arabic: applySmartPartialTashkeel(
            `عِنْدَما ${bareWord} المُتَعَلِّمُ بِانْتِظامٍ، يُلاحِظُ تَقَدُّمًا واضِحًا فِي مَهاراتِهِ.`
          ),
          english: `When the learner practices regularly (${cleanMeaning}), they notice clear progress in their skills.`,
          contextLabel: 'Intermediate · Practical Context',
        }
      : {
          arabic: applySmartPartialTashkeel(
            `تَحَدَّثْنا اليَوْمَ فِي النَّدْوَةِ عَنْ أَهَمِّيَّةِ «${bareWord}» فِي الحَياةِ اليَوْمِيَّةِ.`
          ),
          english: `Today at the seminar we discussed the importance of "${cleanMeaning}" in daily life.`,
          contextLabel: 'Intermediate · Practical Context',
        };

  const secondary: SentencePair =
    cleanContext && countArabicWords(cleanContext) >= 6
      ? {
          arabic: cleanContext,
          english: 'Original sentence from your Intermediate reading passage.',
          contextLabel: 'Passage Context',
        }
      : {
          arabic: applySmartPartialTashkeel(
            `يَسْتَخْدِمُ الكُتَّابُ كَلِمَةَ «${bareWord}» عِنْدَ وَصْفِ المَواقِفِ الواقِعِيَّةِ.`
          ),
          english: `Writers use "${cleanMeaning}" when describing real-life situations.`,
          contextLabel: 'Intermediate · Conversational Use',
        };

  return [primary, secondary];
}

function selectLevelMatchedExamples(
  match: LexiconEntry,
  contextSentence: string | undefined,
  level: ProficiencyLevel
): SentencePair[] {
  const formattedExisting = match.examples.map((ex, idx) => ({
    arabic: applySmartPartialTashkeel(ex.arabic),
    english: ex.english,
    contextLabel:
      ex.contextLabel || (idx === 0 ? 'Everyday Use' : 'Alternate Context'),
  }));

  const wordCounts = formattedExisting.map((ex) => countArabicWords(ex.arabic));
  const wordType = match.wordType || inferArabicWordType(match.partOfSpeech);

  if (level === 'beginner') {
    const shortOnes = formattedExisting.filter((_, idx) => wordCounts[idx] <= 8);
    if (shortOnes.length >= 2) {
      return shortOnes.map((ex, idx) => ({
        ...ex,
        contextLabel: idx === 0 ? 'Beginner · Everyday Use' : 'Beginner · Clear Example',
      }));
    }
    const synthesized = buildLevelFallbackExamples(
      match.wordWithTashkeel,
      match.englishMeaning,
      wordType,
      contextSentence,
      'beginner'
    );
    return shortOnes.length === 1
      ? [
          { ...shortOnes[0], contextLabel: 'Beginner · Everyday Use' },
          synthesized[0],
        ]
      : synthesized;
  }

  if (level === 'advanced') {
    const richOnes = formattedExisting.filter((_, idx) => wordCounts[idx] >= 9);
    if (richOnes.length >= 2) {
      return richOnes.map((ex, idx) => ({
        ...ex,
        contextLabel: idx === 0 ? 'Advanced · Literary Context' : 'Advanced · Alternate Sense',
      }));
    }
    const synthesized = buildLevelFallbackExamples(
      match.wordWithTashkeel,
      match.englishMeaning,
      wordType,
      contextSentence,
      'advanced'
    );
    return richOnes.length === 1
      ? [
          { ...richOnes[0], contextLabel: 'Advanced · Nuanced Context' },
          synthesized[0],
        ]
      : synthesized;
  }

  // Intermediate
  return formattedExisting.map((ex, idx) => ({
    ...ex,
    contextLabel: idx === 0 ? 'Intermediate · Practical Use' : 'Alternate Context',
  }));
}

function stripStandaloneTransliterationCase(
  translit: string,
  originalAr: string,
  standaloneAr: string
): string {
  if (!translit || stripTashkeel(originalAr) === stripTashkeel(standaloneAr)) {
    return translit;
  }
  // If accusative -an (or -un/-in) tanween ending was normalized off the Arabic noun, clean transliteration too
  return translit.replace(/(an|un|in)$/i, '').trim() || translit;
}

export function lookupFallbackWord(
  rawWord: string,
  contextSentence?: string,
  notice?: string,
  level: ProficiencyLevel = 'intermediate'
): WordAnalysis | null {
  const cleanOriginal = rawWord.trim();
  const match = findExactLexiconMatch(cleanOriginal);

  if (!match) {
    return null;
  }

  const resolvedWordType = match.wordType || inferArabicWordType(match.partOfSpeech);
  const standaloneAr = normalizeStandaloneVocabWord(match.wordWithTashkeel, {
    wordType: resolvedWordType,
    partOfSpeech: match.partOfSpeech,
  });
  const finalWordAr = applySmartPartialTashkeel(standaloneAr || match.wordWithTashkeel);
  return {
    ...match,
    word: stripTashkeel(finalWordAr),
    wordWithTashkeel: finalWordAr,
    vocalizedWord: stripFinalIrabForSpeech(match.wordWithTashkeel, {
      wordType: resolvedWordType,
      partOfSpeech: match.partOfSpeech,
    }),
    transliteration: stripStandaloneTransliterationCase(
      match.transliteration,
      match.wordWithTashkeel,
      finalWordAr
    ),
    wordType: resolvedWordType,
    root: formatMinimalArabicRoot(match.root),
    examples: selectLevelMatchedExamples(match, contextSentence, level),
    level,
    source: 'lexicon',
    notice,
  };
}

export function buildResilientWordAnalysis(
  rawWord: string,
  contextSentence?: string,
  notice?: string,
  level: ProficiencyLevel = 'intermediate'
): WordAnalysis {
  const match = lookupFallbackWord(rawWord, contextSentence, notice, level);
  if (match) return match;

  const cleanOriginal = rawWord.trim();
  const resolvedWordType = inferArabicWordType(cleanOriginal);
  const partOfSpeech =
    resolvedWordType === 'فعل'
      ? 'Verb'
      : resolvedWordType === 'حرف'
        ? 'Particle'
        : resolvedWordType === 'ظرف'
          ? 'Adverb'
          : resolvedWordType === 'ضمير'
            ? 'Pronoun'
            : 'Noun';

  const standaloneAr = normalizeStandaloneVocabWord(cleanOriginal, {
    wordType: resolvedWordType,
    partOfSpeech,
  });
  const finalWordAr = applySmartPartialTashkeel(standaloneAr || cleanOriginal);
  const cleanContext = (contextSentence?.trim() || cleanOriginal);

  return {
    word: stripTashkeel(finalWordAr),
    wordWithTashkeel: finalWordAr,
    vocalizedWord: stripFinalIrabForSpeech(cleanOriginal, {
      wordType: resolvedWordType,
      partOfSpeech,
    }),
    partOfSpeech,
    wordType: resolvedWordType,
    root: formatMinimalArabicRoot(cleanOriginal),
    transliteration: '',
    englishMeaning:
      'الترجمة الآلية مشغولة مؤقتًا — Live AI translation is temporarily busy. Please try again shortly.',
    examples:
      cleanContext !== cleanOriginal
        ? [
            {
              arabic: applySmartPartialTashkeel(cleanContext),
              english:
                'جملة من النص — Live AI sentence translation is temporarily busy; please retry shortly.',
              contextLabel: 'Lesson Context',
            },
          ]
        : [],
    level,
    source: 'lexicon',
    notice:
      notice ||
      'الترجمة الآلية مشغولة مؤقتًا — Live AI translation is temporarily busy. Please try again shortly.',
  };
}

export interface LexiconDistractorItem {
  normalizedKey: string;
  wordWithTashkeel: string;
  vocalizedWord: string;
  wordType?: WordAnalysis['wordType'];
  partOfSpeech: string;
  englishMeaning: string;
  transliteration: string;
}

export function getLexiconSamplePool(): LexiconDistractorItem[] {
  return Object.entries(RAW_LEXICON)
    .filter(([, entry]) => entry.partOfSpeech !== 'Preposition' && entry.partOfSpeech !== 'Conjunction')
    .map(([key, entry]) => {
      const wordType = entry.wordType || inferArabicWordType(entry.partOfSpeech);
      return {
        normalizedKey: key,
        wordWithTashkeel: entry.wordWithTashkeel,
        vocalizedWord: stripFinalIrabForSpeech(entry.wordWithTashkeel, {
          wordType,
          partOfSpeech: entry.partOfSpeech,
        }),
        wordType,
        partOfSpeech: entry.partOfSpeech,
        englishMeaning: entry.englishMeaning,
        transliteration: entry.transliteration,
      };
    });
}
