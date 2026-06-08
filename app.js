const API_BASE = "https://api.finna.fi/v1/search";
const PAGE_SIZE = 100;
const MAX_RESULTS_PER_QUERY = 400;
const MAX_PAGES_PER_QUERY = 10;
const RENDER_BATCH_SIZE = 50;
const FIELD_ERROR_MARKER = "field";
const KNOWN_SAFE_FIELD_NAMES = new Set([
  "id",
  "dedupIds",
  "title",
  "authors",
  "author",
  "mainAuthor",
  "primaryAuthors",
  "secondaryAuthors",
  "nonPresenterAuthors",
  "nonPresenterAuthor",
  "author2",
  "author_corporate",
  "year",
  "firstIndexed",
  "languages",
  "majorGenres",
  "buildings",
  "institutions",
  "shortlink",
  "targetAudiences",
  "target_audience",
  "target_audience_str_mv",
  "subjects",
  "subjectsExt",
  "subjectFacets",
  "subject_facet",
  "genres",
  "genreFacets",
  "genre_facet",
  "series",
  "summary",
  "titleStatement",
  "callNumbers",
  "classifications",
  "topicFacets",
  "topic_facet",
]);
const CHILD_KEYWORDS = [
  "children",
  "childrens",
  "childrens literature",
  "laps",
  "lapset",
  "lasten",
  "lastenkirjallisuus",
  "lastenkirja",
  "lastenromaani",
  "kuvakirja",
  "satukirja",
  "satukokoelma",
  "satuja",
  "lastenromaanit",
  "lastenkirjat",
  "lastenkirjallisuutta",
  "lasten kirjallisuus",
  "helppolukuinen",
  "varhaislukija",
  "ella ja kaverit",
  "pikku papu",
  "lasse-maijan",
  "etsivatoimisto",
  "maija mehilainen",
  "heppatytot",
  "heppatytöt",
  "oma pikku",
  "pupu",
  "pupuseni",
  "morkyl",
  "morkylimummi",
  "morkyli",
  "mörkyl",
  "mörkylimummi",
  "mörkyli",
  "iltasadut",
  "lorut",
  "lorukirja",
  "kuvakirjat",
  "lastenosasto",
];
const YOUTH_KEYWORDS = [
  "young adult",
  "ya",
  "nuor",
  "nuortenkirja",
  "nuortenromaani",
  "varhaisnuor",
  "teini",
  "nuoret aikuiset",
  "ylakoulu",
  "yläkoulu",
  "lukio",
  "toisen asteen",
  "high school",
];
const CHILD_TITLE_HINTS = [
  "ella ja kaverit",
  "pikku papu",
  "lasse-maijan",
  "oma pikku",
  "pupuseni",
  "morkylimummi",
  "mörkylimummi",
  "ykkosagentit",
  "ykkösagentit",
  "yksisarviset",
  "sanakirjani",
  "vitsipitsa",
  "tixtuu",
  "aivi",
  "voihan vahvero",
  "kantarelli",
  "iso pieni sanakirjani",
];
const CHILD_PATTERN = /\b(lasten|lapsille|lapsi|lapset|kuvakirj|satukirj|satukokoelm|iltasatu|ensikirj|lastenromaan|lastenkirj|helppolukuin|varhaislukij)\w*/;
const YOUTH_PATTERN = /\b(nuor|young adult|ya|varhaisnuor|teini|nuortenromaan|nuortenkirj)\w*/;

const searchForm = document.getElementById("searchForm");
const textQueryInput = document.getElementById("textQuery");
const genreSelect = document.getElementById("genre");
const languageSelect = document.getElementById("language");
const rangeSelect = document.getElementById("range");
const youthSelect = document.getElementById("youth");
const childrenSelect = document.getElementById("children");
const searchBtn = document.getElementById("searchBtn");
const criteriaNote = document.getElementById("criteriaNote");
const statusMsg = document.getElementById("statusMsg");
const audienceCounter = document.getElementById("audienceCounter");
const resultsEl = document.getElementById("results");
const resultsFooter = document.getElementById("resultsFooter");
const resultsMeta = document.getElementById("resultsMeta");
const showMoreBtn = document.getElementById("showMoreBtn");
const bookTemplate = document.getElementById("bookTemplate");

let currentResults = [];
let renderedCount = 0;

init();

function init() {
  searchForm.addEventListener("submit", handleSearch);
  textQueryInput.addEventListener("input", updateCriteriaNote);
  genreSelect.addEventListener("change", updateCriteriaNote);
  languageSelect.addEventListener("change", updateCriteriaNote);
  rangeSelect.addEventListener("change", updateCriteriaNote);
  youthSelect.addEventListener("change", updateCriteriaNote);
  childrenSelect.addEventListener("change", updateCriteriaNote);
  showMoreBtn.addEventListener("click", renderMoreResults);
  updateCriteriaNote();
  updateResultsFooter();
}

async function handleSearch(event) {
  event.preventDefault();
  updateCriteriaNote();

  setLoading(true);
  setStatus("Haetaan uutuuskirjoja...");
  setAudienceCounter();
  clearRenderedResults();

  try {
    const includeYouth = youthSelect.value === "include";
    const includeChildren = childrenSelect.value === "include";
    const textQuery = textQueryInput.value.trim();
    const queries = buildQueries(textQuery);
    const settled = await Promise.allSettled(queries.map(fetchBooks));

    const fulfilled = settled.filter((item) => item.status === "fulfilled");
    const succeeded = fulfilled.flatMap((item) => item.value);
    const fetchedCount = succeeded.length;
    const failedCount = settled.filter((item) => item.status === "rejected").length;

    if (!fulfilled.length) {
      const firstError = settled.find((item) => item.status === "rejected");
      throw firstError?.reason || new Error("Yksikään haku ei onnistunut.");
    }

    const baseBooks = dedupeById(succeeded)
      .filter((book) => isHelmetRecord(book))
      .filter((book) => matchesGenreSelection(book, genreSelect.value));

    let removedChildren = 0;
    let removedYouth = 0;
    const audiencePassed = [];
    for (const book of baseBooks) {
      const reason = getAudienceExclusionReason(book, includeYouth, includeChildren);
      if (reason === "children") {
        removedChildren += 1;
        continue;
      }
      if (reason === "youth") {
        removedYouth += 1;
        continue;
      }
      audiencePassed.push(book);
    }

    setAudienceCounter({
      sourceCount: baseBooks.length,
      removedChildren,
      removedYouth,
    });

    const recencyFiltered = selectLanguageAwareRecentBooks(audiencePassed);
    const books = recencyFiltered.filter((book) => matchesTextQuery(book, textQuery));

    if (!books.length) {
      const emptyMessage = textQuery ? "Hakusi ei tuottanut tuloksia." : "Ei osumia valituilla suodattimilla.";
      renderEmpty(emptyMessage);
      setStatus(`Valmis. Ei osumia (API ${fetchedCount}).`);
      return;
    }

    renderBooks(books);

    const cappedCount = settled.filter(
      (item) => item.status === "fulfilled" && Array.isArray(item.value) && item.value.length >= MAX_RESULTS_PER_QUERY
    ).length;

    const suffix = cappedCount > 0 ? ` (${cappedCount} osahakua osui ylärajaan ${MAX_RESULTS_PER_QUERY})` : "";

    if (failedCount > 0) {
      setStatus(`Valmis osittain. Löytyi ${books.length} kirjaa / API ${fetchedCount} (${failedCount} kyselyä epäonnistui).${suffix}`);
    } else {
      setStatus(`Valmis. Löytyi ${books.length} kirjaa / API ${fetchedCount}.${suffix}`);
    }
  } catch (error) {
    console.error(error);
    renderEmpty("Haku epäonnistui. Tarkista verkkoyhteys ja yritä uudelleen.");
    const details = String(error?.message || "").trim();
    setStatus(details ? `Virhe haussa: ${details}` : "Virhe haussa.");
  } finally {
    setLoading(false);
  }
}

function setAudienceCounter(stats = null) {
  if (!stats) {
    audienceCounter.textContent = "";
    return;
  }

  const { sourceCount, removedChildren, removedYouth } = stats;
  audienceCounter.textContent = `Yleisösuodatin: lasten vuoksi poistui ${removedChildren}, nuorten vuoksi poistui ${removedYouth} (tarkastettu ${sourceCount}).`;
}

function buildQueries(textQuery) {
  const genres = genreSelect.value === "both" ? [] : [genreSelect.value];
  const languages = languageSelect.value === "either" ? ["fin", "eng"] : [languageSelect.value];
  const currentYearRangeFilter = mapCurrentYearCatalogDate();
  const buildingFilters = ['building:"1/Helmet/n/"'];

  // Haetaan vain tilassa "Tilattu" / "Kasiteltavana" olevasta Helmet-poolista.
  const combos = [];
  for (const buildingFilter of buildingFilters) {
    const filtersBase = [buildingFilter, '~format:"1/Book/Book/"'];

    for (const language of languages) {
      const effectiveRangeFilter = currentYearRangeFilter;
      if (genres.length) {
        for (const genre of genres) {
          combos.push([...filtersBase, effectiveRangeFilter, `~major_genre_str_mv:\"${genre}\"`, `~language:\"${language}\"`]);
        }
      } else {
        combos.push([...filtersBase, effectiveRangeFilter, `~language:\"${language}\"`]);
      }
    }
  }

  return combos.map((filters) => ({ filters, textQuery }));
}

function mapCurrentYearCatalogDate() {
  const currentYear = new Date().getFullYear();
  return `catalog_date:"[${currentYear}-01-01T00:00:00Z TO *]"`;
}

async function fetchBooks(query) {
  const { filters, textQuery } = query;
  const coreFields = [
    "id",
    "dedupIds",
    "title",
    "authors",
    "author",
    "mainAuthor",
    "primaryAuthors",
    "secondaryAuthors",
    "nonPresenterAuthors",
    "nonPresenterAuthor",
    "author2",
    "author_corporate",
    "year",
    "firstIndexed",
    "languages",
    "majorGenres",
    "buildings",
    "shortlink",
  ];

  const audienceFields = [
    "targetAudiences",
    "target_audience",
    "target_audience_str_mv",
    "subjects",
    "subjectsExt",
    "subjectFacets",
    "subject_facet",
    "genres",
    "genreFacets",
    "genre_facet",
    "series",
    "summary",
    "titleStatement",
    "callNumbers",
    "classifications",
    "topicFacets",
    "topic_facet",
  ];

  const preferredFields = uniqueStrings([...coreFields, "institutions", ...audienceFields]).filter((field) =>
    KNOWN_SAFE_FIELD_NAMES.has(field)
  );

  let fields = preferredFields.slice();
  let lastFieldError = null;
  const removedFields = new Set();

  while (fields.length) {
    try {
      return await requestBooks(filters, fields, textQuery);
    } catch (error) {
      const message = String(error?.message || "");
      if (!message.includes(FIELD_ERROR_MARKER)) throw error;
      lastFieldError = error;

      const unsupportedField = extractUnsupportedFieldName(message);
      if (!unsupportedField || removedFields.has(unsupportedField)) break;

      removedFields.add(unsupportedField);
      fields = fields.filter((field) => field !== unsupportedField);
    }
  }

  if (fields.length !== coreFields.length) {
    try {
      return await requestBooks(filters, coreFields, textQuery);
    } catch (error) {
      lastFieldError = error;
    }
  }

  if (lastFieldError) throw lastFieldError;
  throw new Error("Tietojen haku epäonnistui.");
}

function hasHelmetMarker(text) {
  const normalized = normalizeText(text);
  return (
    normalized.includes("helmet") ||
    normalized.includes("helsinki") ||
    normalized.includes("espoo") ||
    normalized.includes("vantaa") ||
    normalized.includes("kauniainen")
  );
}

function isHelmetRecord(record) {
  const recordId = String(record?.id || "").toLowerCase();
  if (recordId.startsWith("helmet.")) return true;

  const dedupIds = Array.isArray(record?.dedupIds) ? record.dedupIds : [];
  if (dedupIds.some((id) => String(id || "").toLowerCase().startsWith("helmet."))) return true;

  const institutions = Array.isArray(record?.institutions) ? record.institutions : [];
  const buildings = Array.isArray(record?.buildings) ? record.buildings : [];

  const institutionText = normalizeText(
    institutions
      .map((item) => (typeof item === "string" ? item : item?.translated || item?.value || ""))
      .join(" ")
  );

  const buildingText = normalizeText(
    buildings
      .map((item) => (typeof item === "string" ? item : item?.translated || item?.value || ""))
      .join(" ")
  );

  return hasHelmetMarker(institutionText) || hasHelmetMarker(buildingText);
}

async function requestBooks(filters, fields, textQuery) {
  const records = [];
  let page = 1;

  while (page <= MAX_PAGES_PER_QUERY && records.length < MAX_RESULTS_PER_QUERY) {
    const payload = await requestBooksPage(filters, fields, page, textQuery);
    const pageRecords = Array.isArray(payload.records) ? payload.records : [];
    const resultCount = Number(payload.resultCount) || 0;

    records.push(...pageRecords);

    const pageFull = pageRecords.length >= PAGE_SIZE;
    const reachedKnownEnd = resultCount > 0 && records.length >= resultCount;
    const reachedCap = records.length >= MAX_RESULTS_PER_QUERY;
    if (!pageFull || reachedKnownEnd || reachedCap) break;

    page += 1;
  }

  return records.slice(0, MAX_RESULTS_PER_QUERY);
}

async function requestBooksPage(filters, fields, page, textQuery) {
  const params = new URLSearchParams();
  params.set("lookfor", textQuery || "*");
  params.set("type", "AllFields");
  params.set("limit", String(PAGE_SIZE));
  params.set("page", String(page));
  params.set("sort", "first_indexed desc,id asc");

  filters.forEach((filter) => params.append("filter[]", filter));
  fields.forEach((field) => params.append("field[]", field));

  const response = await fetch(`${API_BASE}?${params.toString()}`);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API virhe ${response.status}: ${body.slice(0, 180)}`);
  }

  return response.json();
}

function dedupeById(records) {
  const seen = new Set();
  const deduped = [];

  for (const record of records) {
    if (!record?.id || seen.has(record.id)) continue;
    seen.add(record.id);
    deduped.push(record);
  }

  return deduped;
}

function getAudienceExclusionReason(record, includeYouth, includeChildren) {
  const audienceText = buildAudienceText(record);
  const titleText = buildTitleHintText(record);
  const shelfText = buildShelfText(record);
  const hasChildrenClassmark = /\bl\s*\d/.test(shelfText);
  const hasYouthClassmark = /\bn\s*\d/.test(shelfText);
  const hasPictureBookClassmark = /(?:^|\b)85\.2\d*/.test(shelfText);

  const hasJuvenileMarker = audienceText.includes("juvenile");
  const hasYoungAdultMarker = containsAny(audienceText, YOUTH_KEYWORDS) || YOUTH_PATTERN.test(audienceText);
  const hasChildrenAudience = containsAny(audienceText, CHILD_KEYWORDS) || CHILD_PATTERN.test(audienceText);
  const hasChildrenShelfMarker =
    shelfText.includes("lapset") ||
    shelfText.includes("lastenosasto") ||
    shelfText.includes("children") ||
    hasChildrenClassmark ||
    hasPictureBookClassmark;
  const hasYouthShelfMarker = shelfText.includes("nuoret") || shelfText.includes("nuorten") || hasYouthClassmark;
  const hasChildrenTitleHint =
    titleText.startsWith("lasten ") ||
    titleText.startsWith("lapsen ") ||
    titleText.startsWith("lapsille ") ||
    titleText.includes(" lastenkirja") ||
    titleText.includes(" kuvakirja") ||
    titleText.includes(" satukirja") ||
    CHILD_TITLE_HINTS.some((hint) => titleText.includes(hint));
  const inferredChildrenFromJuvenile = hasJuvenileMarker && !hasYoungAdultMarker;
  const isChildrenBook = hasChildrenAudience || hasChildrenTitleHint || hasChildrenShelfMarker || inferredChildrenFromJuvenile;
  if (!includeChildren && isChildrenBook) return "children";

  const hasYouthAudience = hasYoungAdultMarker || hasYouthShelfMarker || (hasJuvenileMarker && !isChildrenBook);
  // Kun lastenkirjat on sallittu, "juvenile"-tagi ei yksinään saa poistaa niitä.
  if (!includeYouth && hasYouthAudience && !(includeChildren && isChildrenBook)) return "youth";

  return null;
}

function buildAudienceText(record) {
  const bucket = [];
  collectText(record?.targetAudiences, bucket);
  collectText(record?.target_audience, bucket);
  collectText(record?.target_audience_str_mv, bucket);
  collectText(record?.majorGenres, bucket);
  collectText(record?.genres, bucket);
  collectText(record?.series, bucket);
  collectText(record?.summary, bucket);
  collectText(record?.titleStatement, bucket);
  collectText(record?.callNumbers, bucket);
  collectText(record?.classifications, bucket);
  collectText(record?.genreFacets, bucket);
  collectText(record?.genre_facet, bucket);
  collectText(record?.subjects, bucket);
  collectText(record?.subjectsExt, bucket);
  collectText(record?.subjectFacets, bucket);
  collectText(record?.subject_facet, bucket);
  collectText(record?.topicFacets, bucket);
  collectText(record?.topic_facet, bucket);
  collectText(record?.title, bucket);
  return normalizeText(bucket.join(" "));
}

function buildShelfText(record) {
  const bucket = [];
  collectText(record?.callNumbers, bucket);
  collectText(record?.classifications, bucket);
  collectText(record?.series, bucket);
  return normalizeText(bucket.join(" "));
}

function buildTitleHintText(record) {
  const bucket = [];
  collectText(record?.title, bucket);
  collectText(record?.titleStatement, bucket);
  collectText(record?.series, bucket);
  collectText(record?.summary, bucket);
  return normalizeText(bucket.join(" "));
}

function collectText(value, bucket) {
  if (value == null) return;

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = String(value).trim();
    if (text) bucket.push(text);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectText(item, bucket));
    return;
  }

  if (typeof value === "object") {
    for (const item of Object.values(value)) {
      collectText(item, bucket);
    }
  }
}

function extractPublicationYear(record) {
  const raw = String(record?.year || "");
  const match = raw.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function selectLanguageAwareRecentBooks(records) {
  if (!Array.isArray(records) || !records.length) return [];

  const finnish = [];
  const others = [];

  for (const record of records) {
    if (isFinnishRecord(record)) finnish.push(record);
    else others.push(record);
  }

  const selectedFinnish = selectFinnishBooksByFirstIndexed(finnish);
  const selectedOthers = selectOtherLanguageBooksByFirstIndexed(others);
  return sortByFirstIndexedDesc([...selectedFinnish, ...selectedOthers]);
}

function isFinnishRecord(record) {
  const languages = Array.isArray(record?.languages) ? record.languages : [];
  return languages.some((language) => normalizeText(language) === "fin");
}

function parseFirstIndexed(record) {
  const value = String(record?.firstIndexed || "").trim();
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getSelectedRangeStartDate() {
  const now = new Date();
  if (rangeSelect.value === "1w") return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (rangeSelect.value === "2w") return new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  if (rangeSelect.value === "2m") {
    const date = new Date(now);
    date.setMonth(date.getMonth() - 2);
    return date;
  }
  if (rangeSelect.value === "6m") {
    const date = new Date(now);
    date.setMonth(date.getMonth() - 6);
    return date;
  }

  const date = new Date(now);
  date.setMonth(date.getMonth() - 1);
  return date;
}

function sortByFirstIndexedDesc(records) {
  return records.slice().sort((a, b) => {
    const aTime = parseFirstIndexed(a)?.getTime() || 0;
    const bTime = parseFirstIndexed(b)?.getTime() || 0;
    return bTime - aTime;
  });
}

function selectFinnishBooksByFirstIndexed(records) {
  if (!records.length) return [];

  const currentYear = new Date().getFullYear();
  const yearStart = new Date(Date.UTC(currentYear, 0, 1, 0, 0, 0));
  const selectedRangeStart = getSelectedRangeStartDate();

  const currentYearRecords = records.filter((record) => {
    const indexedAt = parseFirstIndexed(record);
    return indexedAt ? indexedAt >= yearStart : true;
  });

  const recentWindowRecords = currentYearRecords.filter((record) => {
    const indexedAt = parseFirstIndexed(record);
    return indexedAt ? indexedAt >= selectedRangeStart : true;
  });

  return recentWindowRecords;
}

function selectOtherLanguageBooksByFirstIndexed(records) {
  if (!records.length) return [];

  const currentYear = new Date().getFullYear();
  const yearStart = new Date(Date.UTC(currentYear, 0, 1, 0, 0, 0));
  const selectedRangeStart = getSelectedRangeStartDate();
  const currentYearRecords = records.filter((record) => {
    const indexedAt = parseFirstIndexed(record);
    return indexedAt ? indexedAt >= yearStart : true;
  });
  const recentWindowRecords = currentYearRecords.filter((record) => {
    const indexedAt = parseFirstIndexed(record);
    return indexedAt ? indexedAt >= selectedRangeStart : true;
  });

  return recentWindowRecords;
}

function renderBooks(records) {
  currentResults = records;
  resultsEl.innerHTML = "";
  renderedCount = 0;
  renderMoreResults();
}

function renderMoreResults() {
  if (!currentResults.length) {
    updateResultsFooter();
    return;
  }

  const nextCount = Math.min(renderedCount + RENDER_BATCH_SIZE, currentResults.length);
  for (let index = renderedCount; index < nextCount; index += 1) {
    const book = currentResults[index];
    const node = bookTemplate.content.firstElementChild.cloneNode(true);
    const title = book.title || "Nimetön teos";
    const authors = formatAuthors(book);
    const year = book.year || "-";
    const language = formatLanguages(book.languages);
    const genre = formatGenres(book.majorGenres);
    const bookGenres = formatBookGenres(book);
    const buildings = formatBuildings(book);

    node.querySelector(".book-title").textContent = title;
    node.querySelector(".book-meta").textContent = `${authors} | ${year}`;
    node.querySelector(".book-genres").textContent = `Genret: ${bookGenres}`;
    node.querySelector(".book-extra").textContent = `Kieli: ${language} | Laji: ${genre} | Tila: Tilattu/Kasiteltavana | Helmet-kirjastot: ${buildings}`;

    const linkEl = node.querySelector(".book-link");
    linkEl.href = normalizeShortLink(book.shortlink, book);

    resultsEl.appendChild(node);
  }

  renderedCount = nextCount;
  updateResultsFooter();
}

function renderEmpty(message) {
  clearRenderedResults();
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = message;
  resultsEl.appendChild(empty);
}

function clearRenderedResults() {
  currentResults = [];
  renderedCount = 0;
  resultsEl.innerHTML = "";
  updateResultsFooter();
}

function updateResultsFooter() {
  const total = currentResults.length;
  if (!total) {
    resultsMeta.textContent = "";
    resultsFooter.classList.add("hidden");
    showMoreBtn.classList.add("hidden");
    return;
  }

  const remaining = total - renderedCount;
  resultsMeta.textContent = `Näytetään ${renderedCount}/${total}`;
  resultsFooter.classList.remove("hidden");

  if (remaining > 0) {
    showMoreBtn.textContent = `Näytä lisää (${remaining} jäljellä)`;
    showMoreBtn.classList.remove("hidden");
  } else {
    showMoreBtn.classList.add("hidden");
  }
}

function updateCriteriaNote() {
  const genreLabel = genreSelect.value === "both" ? "kauno + tieto" : genreSelect.value === "fiction" ? "kauno" : "tieto";

  const languageLabel =
    languageSelect.value === "either" ? "suomi/englanti" : languageSelect.value === "fin" ? "suomi" : "englanti";

  const rangeLabel =
    rangeSelect.value === "1w"
      ? "1 viikko"
      : rangeSelect.value === "2w"
      ? "2 viikkoa"
      : rangeSelect.value === "2m"
      ? "2 kuukautta"
      : rangeSelect.value === "6m"
      ? "6 kuukautta"
      : "1 kuukausi";

  const youthLabel = youthSelect.value === "include" ? "nuortenkirjat mukana" : "nuortenkirjat rajataan pois";
  const childrenLabel = childrenSelect.value === "include" ? "lastenkirjat mukana" : "lastenkirjat rajataan pois";
  const textLabel = textQueryInput.value.trim() ? `, haku: "${textQueryInput.value.trim()}"` : "";

  criteriaNote.textContent = `Haku kohdistuu Helmetin tilassa Tilattu/Kasiteltavana oleviin kuluvan vuoden kirjoihin: ${genreLabel}, ${languageLabel}, ${rangeLabel}${textLabel}. ${childrenLabel}, ${youthLabel}.`;
}

function setLoading(isLoading) {
  searchBtn.disabled = isLoading;
  searchBtn.textContent = isLoading ? "Haetaan..." : "Hae uutuuskirjat";
}

function setStatus(message) {
  statusMsg.textContent = message;
}

function extractAuthorNames(record) {
  if (!record || typeof record !== "object") return [];
  const names = [];

  const pushName = (value) => {
    if (!value) return;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) names.push(trimmed);
      return;
    }
    if (typeof value === "object") {
      if (typeof value.name === "string" && value.name.trim()) {
        names.push(value.name.trim());
        return;
      }
      if (typeof value.fullerForm === "string" && value.fullerForm.trim()) {
        names.push(value.fullerForm.trim());
      }
    }
  };

  const candidateFields = [
    record.authors,
    record.mainAuthor,
    record.author,
    record.primaryAuthors,
    record.secondaryAuthors,
    record.nonPresenterAuthors,
    record.nonPresenterAuthor,
  ];

  for (const field of candidateFields) {
    if (Array.isArray(field)) {
      field.forEach(pushName);
    } else if (field && typeof field === "object") {
      for (const value of Object.values(field)) {
        if (Array.isArray(value)) value.forEach(pushName);
        else pushName(value);
      }
    } else {
      pushName(field);
    }
  }

  if (Array.isArray(record.author2)) {
    record.author2.forEach(pushName);
  } else if (record.author2) {
    pushName(record.author2);
  }

  if (Array.isArray(record.author_corporate)) {
    record.author_corporate.forEach(pushName);
  } else if (record.author_corporate) {
    pushName(record.author_corporate);
  }

  if (record.authors && typeof record.authors === "object" && !Array.isArray(record.authors)) {
    for (const value of Object.values(record.authors)) {
      if (Array.isArray(value)) value.forEach(pushName);
      else pushName(value);
    }
  }

  return [...new Set(names)];
}

function formatAuthors(record) {
  const names = extractAuthorNames(record);
  return names.length ? names.join(", ") : "Tekijä ei tiedossa";
}

function matchesTextQuery(record, textQuery) {
  const query = normalizeText(textQuery);
  if (!query) return true;

  const haystack = normalizeText(
    [
      record?.title || "",
      extractAuthorNames(record).join(" "),
      record?.year || "",
      formatGenres(record?.majorGenres),
    ].join(" ")
  );

  const ignoredTokens = new Set([
    "kirja",
    "kirjoittaja",
    "kaantaja",
    "kääntäjä",
    "toimittaja",
    "romaani",
    "pienoisromaani",
  ]);

  const tokens = query
    .split(/[^a-z0-9åäö]+/i)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token.length > 1)
    .filter((token) => !ignoredTokens.has(token));

  if (!tokens.length) return true;
  const matches = tokens.filter((token) => haystack.includes(token)).length;
  if (tokens.length <= 2) return matches === tokens.length;
  return matches >= 2;
}

function matchesGenreSelection(record, selectedGenre) {
  if (selectedGenre === "both") return true;

  const genres = Array.isArray(record?.majorGenres) ? record.majorGenres : [];
  if (!genres.length) return false;

  const normalizedGenres = genres.map((genre) => normalizeText(genre));
  if (selectedGenre === "fiction") {
    return normalizedGenres.some(
      (genre) => (genre.includes("fiction") && !genre.includes("nonfiction")) || genre.includes("kauno")
    );
  }

  if (selectedGenre === "nonfiction") {
    return normalizedGenres.some(
      (genre) => genre.includes("nonfiction") || genre.includes("tieto") || genre.includes("fakta")
    );
  }

  return true;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function containsAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function extractUnsupportedFieldName(message) {
  const match = String(message || "").match(/field[^a-z0-9_]+([a-z0-9_]+)/i);
  return match ? match[1] : "";
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function formatLanguages(languages) {
  if (!Array.isArray(languages) || !languages.length) return "-";
  return languages.join(", ");
}

function formatGenres(genres) {
  if (!Array.isArray(genres) || !genres.length) return "-";
  return genres.join(", ");
}

function formatBookGenres(record) {
  const genres = Array.isArray(record?.genres) ? record.genres : [];
  if (genres.length) return uniqueStrings(genres.map((genre) => String(genre).trim()).filter(Boolean)).join(", ");

  const genreFacets = Array.isArray(record?.genreFacets) ? record.genreFacets : [];
  if (genreFacets.length) {
    return uniqueStrings(genreFacets.map((genre) => String(genre).trim()).filter(Boolean)).join(", ");
  }

  return "-";
}

function formatBuildings(record) {
  const helmetId = extractHelmetId(record);
  if (helmetId && !String(record?.id || "").toLowerCase().startsWith("helmet.")) {
    return "Helmet (Helsinki, Espoo, Vantaa, Kauniainen)";
  }

  const buildings = Array.isArray(record?.buildings) ? record.buildings : [];
  if (!Array.isArray(buildings) || !buildings.length) return "-";
  const values = buildings
    .map((item) => item?.translated || item?.value)
    .filter(Boolean)
    .map((item) => String(item));

  const helmetOnly = values.filter((value) => hasHelmetMarker(value));
  const picked = helmetOnly.length ? helmetOnly : values;

  return picked
    .slice(0, 3)
    .join(", ");
}

function extractHelmetId(record) {
  const ownId = String(record?.id || "");
  if (ownId.toLowerCase().startsWith("helmet.")) return ownId;

  const dedupIds = Array.isArray(record?.dedupIds) ? record.dedupIds : [];
  const helmetDedup = dedupIds.find((id) => String(id || "").toLowerCase().startsWith("helmet."));
  return helmetDedup ? String(helmetDedup) : "";
}

function normalizeShortLink(shortlink, record) {
  const helmetId = extractHelmetId(record);
  if (helmetId) {
    return `https://helmet.finna.fi/Record/${encodeURIComponent(helmetId)}`;
  }

  if (typeof shortlink === "string" && shortlink.startsWith("http")) {
    return shortlink;
  }

  return `https://helmet.finna.fi/`;
}
