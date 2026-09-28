const RANKS = [
  'A','K','Q','J','T','9','8','7','6','5','4','3','2'
];

const COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#64748b',
  '#111827',
  '#F8F8F6'
];

const DB_NAME = 'PokerRangeDrill';
const DB_VERSION = 1;

let db;

const state = {
  view: 'ranges',
  editing: null,
  selectedCells: new Set(),
  drill: null
};

let gridPointerActive = false;
let gridSelectionMode = true;
let lastTouchedHand = null;


/* =========================================================
   OUTILS
========================================================= */

function uid(prefix) {
  return (
    prefix +
    '_' +
    Date.now().toString(36) +
    '_' +
    Math.random().toString(36).slice(2, 7)
  );
}


function handAt(row, col) {

  if (row === col) {
    return RANKS[row] + RANKS[col];
  }

  return row < col
    ? RANKS[row] + RANKS[col] + 's'
    : RANKS[col] + RANKS[row] + 'o';
}


function allHands() {

  const hands = [];

  for (let row = 0; row < 13; row++) {

    for (let col = 0; col < 13; col++) {

      hands.push(
        handAt(row, col)
      );
    }
  }

  return hands;
}


function esc(value) {

  return String(value ?? '').replace(
    /[&<>"']/g,
    character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[character])
  );
}


function cleanExcelValue(value) {

  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  return String(value).trim();
}


/* =========================================================
   INDEXEDDB
========================================================= */

function openDB() {

  return new Promise((resolve, reject) => {

    const request =
      indexedDB.open(
        DB_NAME,
        DB_VERSION
      );

    request.onupgradeneeded = () => {

      const database = request.result;

      if (
        !database.objectStoreNames.contains(
          'ranges'
        )
      ) {

        database.createObjectStore(
          'ranges',
          {
            keyPath: 'id'
          }
        );
      }

      if (
        !database.objectStoreNames.contains(
          'history'
        )
      ) {

        database.createObjectStore(
          'history',
          {
            keyPath: 'id'
          }
        );
      }
    };

    request.onsuccess = () => {

      db = request.result;

      db.onversionchange = () => {
        db.close();
      };

      resolve();
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}


function tx(store, mode = 'readonly') {

  return db
    .transaction(
      store,
      mode
    )
    .objectStore(store);
}


function getRanges() {

  return new Promise((resolve, reject) => {

    const request =
      tx('ranges').getAll();

    request.onsuccess = () => {
      resolve(request.result || []);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}


function putRange(range) {

  return new Promise((resolve, reject) => {

    const request =
      tx(
        'ranges',
        'readwrite'
      ).put(range);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}


function delRange(id) {

  return new Promise((resolve, reject) => {

    const request =
      tx(
        'ranges',
        'readwrite'
      ).delete(id);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}


function getHistory() {

  return new Promise((resolve, reject) => {

    const request =
      tx('history').getAll();

    request.onsuccess = () => {
      resolve(request.result || []);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}


function addHistory(history) {

  return new Promise((resolve, reject) => {

    const request =
      tx(
        'history',
        'readwrite'
      ).put(history);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}


function deleteHistory(id) {

  return new Promise((resolve, reject) => {

    const request =
      tx(
        'history',
        'readwrite'
      ).delete(id);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}


async function trimHistory() {

  const history =
    (await getHistory())
      .sort(
        (a, b) =>
          new Date(b.date) -
          new Date(a.date)
      );

  for (
    const item of history.slice(5)
  ) {

    await deleteHistory(item.id);
  }
}


/* =========================================================
   INITIALISATION
========================================================= */

async function init() {

  if (
    !window.indexedDB
  ) {

    throw new Error(
      'IndexedDB non disponible.'
    );
  }

  await openDB();

  if (
    'serviceWorker' in navigator
  ) {

    navigator.serviceWorker
      .register(
        './service-worker.js'
      )
      .catch(error => {
        console.warn(
          'Service Worker :',
          error
        );
      });
  }

  render();
}


/* =========================================================
   NAVIGATION
========================================================= */

function nav(view) {

  if (
    ![
      'ranges',
      'editor',
      'setup',
      'question',
      'result'
    ].includes(view)
  ) {
    return;
  }

  state.view = view;

  if (
    view !== 'editor'
  ) {

    state.editing = null;
    state.selectedCells.clear();
  }

  render();
}


function render() {

  const app =
    document.getElementById('app');

  if (!app) {
    return;
  }

  document
    .querySelectorAll(
      '.bottom-nav button'
    )
    .forEach(button => {

      const navValue =
        button.dataset.nav;

      const active =
        navValue === state.view ||

        (
          state.view === 'editor' &&
          navValue === 'ranges'
        ) ||

        (
          [
            'setup',
            'question',
            'result'
          ].includes(state.view) &&
          navValue === 'drill'
        );

      button.classList.toggle(
        'active',
        active
      );
    });


  if (
    state.view === 'ranges'
  ) {

    renderRanges(app);

    return;
  }


  if (
    state.view === 'editor'
  ) {

    renderEditor(app);

    return;
  }


  if (
    state.view === 'setup'
  ) {

    renderSetup(app);

    return;
  }


  renderDrill(app);
}


/* =========================================================
   GROUPES DE RANGES
========================================================= */

function groupRangesByPosition(ranges) {

  const groups = {};

  for (
    const range of ranges
  ) {

    const position =
      (
        range.informations?.position ||
        ''
      ).trim() ||
      'Sans position';

    if (
      !groups[position]
    ) {

      groups[position] = [];
    }

    groups[position].push(
      range
    );
  }


  const order = [
    'UTG',
    'HJ',
    'CO',
    'BTN',
    'SB',
    'BB',
    'Sans position'
  ];


  return Object.entries(
    groups
  ).sort(
    ([a], [b]) => {

      const indexA =
        order.indexOf(a);

      const indexB =
        order.indexOf(b);


      if (
        indexA !== -1 &&
        indexB !== -1
      ) {

        return indexA - indexB;
      }


      if (
        indexA !== -1
      ) {

        return -1;
      }


      if (
        indexB !== -1
      ) {

        return 1;
      }


      return a.localeCompare(
        b,
        'fr'
      );
    }
  );
}


function positionGroupHTML(
  position,
  ranges,
  options = {}
) {

  const drillMode =
    options.drillMode === true;


  const groupId =
    'group_' +
    position
      .replace(
        /[^a-zA-Z0-9]/g,
        '_'
      );


  if (drillMode) {

    return `

      <section class="range-group">

        <div
          class="range-group-header"
          data-group="${esc(groupId)}"
        >

          <div class="group-title">

            <span class="group-arrow">
              ▶
            </span>

            <b>
              ${esc(position)}
            </b>

            <span class="muted">
              · ${ranges.length}
              range${ranges.length > 1 ? 's' : ''}
            </span>

          </div>

          <label
            class="group-check"
            onclick="event.stopPropagation()"
          >

            <input
              type="checkbox"
              class="position-check"
              data-position="${esc(position)}"
            >

          </label>

        </div>


        <div
          class="range-group-content"
          id="${esc(groupId)}"
          hidden
        >

          ${
            ranges.map(range => `

              <label class="check-row drill-range-row">

                <input
                  type="checkbox"
                  class="range-check"
                  value="${esc(range.id)}"
                >

                <span class="grow">

                  <b>
                    ${esc(range.nom)}
                  </b>

                  <br>

                  <small class="muted">
                    ${
                      Object
                        .values(range.mains)
                        .filter(
                          value =>
                            value.length
                        )
                        .length
                    }/169 définies
                  </small>

                </span>

              </label>

            `).join('')
          }

        </div>

      </section>
    `;
  }


  return `

    <section class="range-group">

      <div
        class="range-group-header"
        data-group="${esc(groupId)}"
      >

        <div class="group-title">

          <span class="group-arrow">
            ▶
          </span>

          <b>
            ${esc(position)}
          </b>

          <span class="muted">
            · ${ranges.length}
            range${ranges.length > 1 ? 's' : ''}
          </span>

        </div>

      </div>


      <div
        class="range-group-content"
        id="${esc(groupId)}"
        hidden
      >

        ${
          ranges.map(range => `

            <section class="card range-card">

              <div class="range-main">

                <div class="range-name">
                  ${esc(range.nom)}
                </div>

                <div class="chips">

                  ${
                    range.informations?.position
                      ? `
                        <span class="chip">
                          ${esc(
                            range.informations.position
                          )}
                        </span>
                      `
                      : ''
                  }

                  ${
                    range.informations?.stack
                      ? `
                        <span class="chip">
                          ${esc(
                            range.informations.stack
                          )}
                        </span>
                      `
                      : ''
                  }

                  ${
                    range.informations?.situation
                      ? `
                        <span class="chip">
                          ${esc(
                            range.informations.situation
                          )}
                        </span>
                      `
                      : ''
                  }

                  <span class="chip">
                    ${
                      Object
                        .values(range.mains)
                        .filter(
                          value =>
                            value.length
                        )
                        .length
                    }/169
                  </span>

                </div>

              </div>


              <div class="actions">

                <button
                  class="btn secondary edit"
                  data-id="${esc(range.id)}"
                >
                  Modifier
                </button>

                <button
                  class="btn danger delete"
                  data-id="${esc(range.id)}"
                >
                  ×
                </button>

              </div>

            </section>

          `).join('')
        }

      </div>

    </section>
  `;
}


/* =========================================================
   EXPORT JSON
========================================================= */

function downloadJSON(
  data,
  filename
) {

  const blob =
    new Blob(
      [
        JSON.stringify(
          data,
          null,
          2
        )
      ],
      {
        type:
          'application/json'
      }
    );


  const url =
    URL.createObjectURL(
      blob
    );


  const link =
    document.createElement(
      'a'
    );

  link.href = url;
  link.download = filename;

  document.body.appendChild(
    link
  );

  link.click();

  link.remove();

  URL.revokeObjectURL(
    url
  );
}


async function exportRanges() {

  const ranges =
    await getRanges();

  if (
    !ranges.length
  ) {

    alert(
      'Aucune range à exporter.'
    );

    return;
  }


  const backup = {

    app:
      'PokerRangeDrill',

    version:
      1,

    exportedAt:
      new Date().toISOString(),

    ranges:
      ranges
  };


  downloadJSON(
    backup,
    'poker-range-drill-backup.json'
  );
}


/* =========================================================
   IMPORT JSON
========================================================= */

function normalizeImportedRange(range) {

  if (
    !range ||
    typeof range !== 'object'
  ) {
    return null;
  }


  if (
    typeof range.nom !== 'string'
  ) {
    return null;
  }


  if (
    !range.informations ||
    typeof range.informations !== 'object'
  ) {
    return null;
  }


  if (
    !Array.isArray(
      range.etiquettes
    )
  ) {
    return null;
  }


  if (
    !range.mains ||
    typeof range.mains !== 'object'
  ) {
    return null;
  }


  const normalized = {

    id:
      typeof range.id === 'string' &&
      range.id
        ? range.id
        : uid('range'),

    nom:
      range.nom,

    informations: {

      position:
        String(
          range.informations.position ??
          ''
        ),

      stack:
        String(
          range.informations.stack ??
          ''
        ),

      situation:
        String(
          range.informations.situation ??
          ''
        )
    },

    etiquettes: [],

    mains:
      Object.fromEntries(
        allHands().map(
          hand => [
            hand,
            []
          ]
        )
      )
  };


  const labelIds =
    new Set();


  for (
    const label of range.etiquettes
  ) {

    if (
      !label ||
      typeof label.nom !== 'string' ||
      !label.nom.trim()
    ) {
      continue;
    }


    const id =
      typeof label.id === 'string' &&
      label.id
        ? label.id
        : uid('label');


    if (
      labelIds.has(id)
    ) {
      continue;
    }


    labelIds.add(id);


    normalized.etiquettes.push({

      id:

        id,

      nom:
        label.nom,

      couleur:
        typeof label.couleur === 'string'
          ? label.couleur
          : '#111827'
    });
  }


  const validLabels =
    new Set(
      normalized.etiquettes.map(
        label => label.id
      )
    );


  for (
    const hand of allHands()
  ) {

    const values =
      Array.isArray(
        range.mains[hand]
      )
        ? range.mains[hand]
        : [];


    normalized.mains[hand] =
      values
        .filter(
          id =>
            validLabels.has(id)
        )
        .slice(0, 2);
  }


  return normalized;
}


async function importRangesFromFile(
  file,
  mode
) {

  let data;


  try {

    const text =
      await file.text();

    data =
      JSON.parse(text);

  } catch (error) {

    alert(
      'Le fichier sélectionné n’est pas un fichier JSON valide.'
    );

    return;
  }


  const imported =
    Array.isArray(data)
      ? data
      : data?.ranges;


  if (
    !Array.isArray(imported)
  ) {

    alert(
      'Ce fichier ne contient pas de ranges PokerRangeDrill.'
    );

    return;
  }


  const ranges =
    imported
      .map(
        normalizeImportedRange
      )
      .filter(Boolean);


  if (
    !ranges.length
  ) {

    alert(
      'Aucune range valide n’a été trouvée dans le fichier.'
    );

    return;
  }


  const existing =
    await getRanges();


  const existingIds =
    new Set(
      existing.map(
        range => range.id
      )
    );


  let added = 0;
  let replaced = 0;
  let skipped = 0;
  let duplicated = 0;


  for (
    const range of ranges
  ) {

    if (
      !existingIds.has(
        range.id
      )
    ) {

      await putRange(
        range
      );

      existingIds.add(
        range.id
      );

      added++;

      continue;
    }


    if (
      mode === 'replace'
    ) {

      await putRange(
        range
      );

      replaced++;

    } else if (
      mode === 'keep'
    ) {

      skipped++;

    } else if (
      mode === 'duplicate'
    ) {

      const copy =
        structuredClone(
          range
        );

      copy.id =
        uid('range');

      await putRange(
        copy
      );

      duplicated++;
    }
  }


  render();


  alert(
    `Import terminé.\n\n` +
    `Nouvelles ranges : ${added}\n` +
    `Ranges remplacées : ${replaced}\n` +
    `Ranges conservées : ${skipped}\n` +
    `Copies créées : ${duplicated}`
  );
}


async function openImportMode(
  file
) {

  const existing =
    await getRanges();


  if (
    !existing.length
  ) {

    await importRangesFromFile(
      file,
      'keep'
    );

    return;
  }


  const choice =
    prompt(
      `Des ranges existent déjà dans l'application.\n\n` +
      `Que veux-tu faire lorsqu'une range importée possède le même identifiant ?\n\n` +
      `1 = Remplacer la range existante\n` +
      `2 = Conserver la range existante\n` +
      `3 = Garder les deux\n\n` +
      `Entre 1, 2 ou 3.`
    );


  if (
    choice === '1'
  ) {

    await importRangesFromFile(
      file,
      'replace'
    );

  } else if (
    choice === '2'
  ) {

    await importRangesFromFile(
      file,
      'keep'
    );

  } else if (
    choice === '3'
  ) {

    await importRangesFromFile(
      file,
      'duplicate'
    );

  } else {

    alert(
      'Import annulé.'
    );
  }
}


function importRanges() {

  const input =
    document.createElement(
      'input'
    );

  input.type = 'file';

  input.accept =
    '.json,application/json';


  input.onchange = () => {

    const file =
      input.files?.[0];

    if (!file) {
      return;
    }

    openImportMode(
      file
    );
  };


  input.click();
}


/* =========================================================
   IMPORT EXCEL
========================================================= */

function createImportedLabel(
  range,
  action
) {

  action =
    cleanExcelValue(
      action
    );


  if (!action) {
    return null;
  }


  const existing =
    range.etiquettes.find(
      label =>
        label.nom
          .trim()
          .toLowerCase() ===
        action
          .trim()
          .toLowerCase()
    );


  if (
    existing
  ) {

    return existing.id;
  }


  const label = {

    id:
      uid('label'),

    nom:
      action,

    couleur:
      COLORS[
        range.etiquettes.length %
        COLORS.length
      ]
  };


  range.etiquettes.push(
    label
  );


  return label.id;
}


function convertExcelSheetToRange(
  sheet
) {

  if (
    typeof XLSX === 'undefined'
  ) {

    return null;
  }


  const data =
    XLSX.utils.sheet_to_json(
      sheet,
      {
        header: 1,
        defval: ''
      }
    );


  if (
    !data.length
  ) {

    return null;
  }


  /*
    Structure attendue :

    A1 = Nom de la range
    B1 = valeur

    A2 = Position
    B2 = valeur

    A3 = Stack
    B3 = valeur

    A4 = Situation
    B4 = valeur

    À partir de D :
    D = main
    E = action
    F = main
    G = action
    etc.

    Les 13 lignes de mains
    vont de la ligne 3 à la ligne 15.
  */


  const nom =
    cleanExcelValue(
      data[0]?.[1]
    );

  const position =
    cleanExcelValue(
      data[1]?.[1]
    );

  const stack =
    cleanExcelValue(
      data[2]?.[1]
    );

  const situation =
    cleanExcelValue(
      data[3]?.[1]
    );


  if (!nom) {
    return null;
  }


  const range = {

    id:
      uid('range'),

    nom:
      nom,

    informations: {

      position:
        position,

      stack:
        stack,

      situation:
        situation
    },

    etiquettes: [],

    mains:
      Object.fromEntries(
        allHands().map(
          hand => [
            hand,
            []
          ]
        )
      )
  };


  /*
    Excel :

    colonne D = index 3
    colonne E = index 4

    puis F/G,
    H/I,
    etc.

    13 colonnes de mains
    = 26 colonnes Excel.
  */


  for (
    let row = 2;
    row < 15;
    row++
  ) {

    for (
      let col = 3;
      col < 29;
      col += 2
    ) {

      const main =
        cleanExcelValue(
          data[row]?.[col]
        );

      const action =
        cleanExcelValue(
          data[row]?.[col + 1]
        );


      if (!main) {
        continue;
      }


      if (
        !allHands().includes(
          main
        )
      ) {

        continue;
      }


      if (!action) {
        continue;
      }


      /*
        IMPORTANT :

        "+" est utilisé comme séparateur
        pour deux étiquettes.

        Exemple :
        Raise/Call + Shove

        En revanche :
        Raise/Fold
        Raise/Call

        restent une seule étiquette.
      */


      const finalActions =
        action
          .split(/\s*\+\s*/)
          .map(
            value =>
              value.trim()
          )
          .filter(Boolean)
          .slice(0, 2);


      const labelIds = [];


      for (
        const labelName of finalActions
      ) {

        if (
          labelIds.length >= 2
        ) {
          break;
        }


        const labelId =
          createImportedLabel(
            range,
            labelName
          );


        if (
          labelId
        ) {

          labelIds.push(
            labelId
          );
        }
      }


      range.mains[main] =
        labelIds;
    }
  }


  return range;
}


async function importExcelFile(
  file
) {

  if (
    typeof XLSX === 'undefined'
  ) {

    alert(
      'Le lecteur Excel n’est pas disponible.\n\n' +
      'Vérifie que SheetJS est bien chargé dans index.html.'
    );

    return;
  }


  let workbook;


  try {

    const buffer =
      await file.arrayBuffer();

    workbook =
      XLSX.read(
        buffer,
        {
          type: 'array'
        }
      );

  } catch (error) {

    console.error(
      error
    );

    alert(
      'Impossible de lire ce fichier Excel.'
    );

    return;
  }


  const imported = [];


  for (
    const sheetName of workbook.SheetNames
  ) {

    const sheet =
      workbook.Sheets[
        sheetName
      ];


    const range =
      convertExcelSheetToRange(
        sheet
      );


    if (
      range
    ) {

      imported.push(
        range
      );
    }
  }


  if (
    !imported.length
  ) {

    alert(
      'Aucune range valide n’a été trouvée dans le fichier Excel.'
    );

    return;
  }


  const existing =
    await getRanges();


  const existingIds =
    new Set(
      existing.map(
        range => range.id
      )
    );


  let added = 0;


  for (
    const range of imported
  ) {

    while (
      existingIds.has(
        range.id
      )
    ) {

      range.id =
        uid('range');
    }


    await putRange(
      range
    );


    existingIds.add(
      range.id
    );


    added++;
  }


  render();


  alert(
    `Import Excel terminé.\n\n` +
    `${added} range` +
    `${added > 1 ? 's' : ''} ` +
    `importée` +
    `${added > 1 ? 's' : ''}.`
  );
}


function importExcel() {

  const input =
    document.createElement(
      'input'
    );


  input.type = 'file';


  input.accept =
    '.xlsx,.xls,' +
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
    'application/vnd.ms-excel';


  input.onchange = () => {

    const file =
      input.files?.[0];

    if (!file) {
      return;
    }


    importExcelFile(
      file
    );
  };


  input.click();
}


/* =========================================================
   MES RANGES
========================================================= */

async function renderRanges(app) {

  const ranges =
    await getRanges();


  const history =
    (await getHistory())
      .sort(
        (a, b) =>
          new Date(b.date) -
          new Date(a.date)
      );


  const groups =
    groupRangesByPosition(
      ranges
    );


  app.innerHTML = `

    <main class="app">

      <div class="top">

        <h1>
          Mes ranges
        </h1>

        <button
          class="btn"
          id="newRange"
        >
          + Créer
        </button>

      </div>


      <div class="toolbar backup-toolbar">

        <button
          class="btn secondary"
          id="exportRanges"
        >
          ↓ Exporter mes ranges
        </button>

        <button
          class="btn secondary"
          id="importRanges"
        >
          ↑ Importer JSON
        </button>

        <button
          class="btn secondary"
          id="importExcel"
        >
          ↑ Importer Excel
        </button>

      </div>


      ${
        ranges.length

          ?

          `

            <div class="range-groups">

              ${
                groups
                  .map(
                    ([position, groupRanges]) =>
                      positionGroupHTML(
                        position,
                        groupRanges
                      )
                  )
                  .join('')
              }

            </div>

          `

          :

          `

            <div class="card empty">

              <div class="big">
                Aucune range
              </div>

              <p class="muted">
                Crée ta première range
                pour commencer tes drills.
              </p>

              <button
                class="btn"
                id="emptyNew"
              >
                Créer une range
              </button>

            </div>

          `
      }


      <div class="card">

        <div
          class="section-title"
          style="margin-top:0"
        >
          Historique
        </div>


        ${
          history.length

            ?

            history
              .map(item => {

                const percentage =
                  item.total
                    ? Math.round(
                        item.score /
                        item.total *
                        100
                      )
                    : 0;


                const date =
                  new Date(
                    item.date
                  );


                return `

                  <div class="history-item">

                    <div class="history-main">

                      <div>

                        <b>
                          ${
                            date.toLocaleDateString(
                              'fr-FR'
                            )
                          }

                          à

                          ${
                            date.toLocaleTimeString(
                              'fr-FR',
                              {
                                hour: '2-digit',
                                minute: '2-digit'
                              }
                            )
                          }
                        </b>

                        <br>

                        <span class="muted">
                          ${item.total} mains
                        </span>

                      </div>


                      <div class="history-score">
                        ${item.score}/${item.total}
                      </div>

                    </div>


                    <div>
                      <b>
                        ${percentage} % de réussite
                      </b>
                    </div>

                  </div>

                `;
              })
              .join('')

            :

            `

              <div class="muted">
                Aucun drill réalisé pour le moment.
              </div>

            `
        }

      </div>

    </main>
  `;


  document
    .getElementById(
      'newRange'
    )
    ?.addEventListener(
      'click',
      () => openEditor()
    );


  document
    .getElementById(
      'emptyNew'
    )
    ?.addEventListener(
      'click',
      () => openEditor()
    );


  document
    .getElementById(
      'exportRanges'
    )
    ?.addEventListener(
      'click',
      exportRanges
    );


  document
    .getElementById(
      'importRanges'
    )
    ?.addEventListener(
      'click',
      importRanges
    );


  document
    .getElementById(
      'importExcel'
    )
    ?.addEventListener(
      'click',
      importExcel
    );


  app
    .querySelectorAll(
      '.range-group-header'
    )
    .forEach(header => {

      header.onclick = () => {

        const content =
          document.getElementById(
            header.dataset.group
          );


        if (!content) {
          return;
        }


        const arrow =
          header.querySelector(
            '.group-arrow'
          );


        content.hidden =
          !content.hidden;


        if (arrow) {

          arrow.textContent =
            content.hidden
              ? '▶'
              : '▼';
        }
      };
    });


  app
    .querySelectorAll(
      '.edit'
    )
    .forEach(button => {

      button.onclick =
        async event => {

          event.stopPropagation();


          const all =
            await getRanges();


          const range =
            all.find(
              item =>
                item.id ===
                button.dataset.id
            );


          if (range) {

            openEditor(
              range
            );
          }
        };
    });


  app
    .querySelectorAll(
      '.delete'
    )
    .forEach(button => {

      button.onclick =
        async event => {

          event.stopPropagation();


          if (
            !confirm(
              'Supprimer cette range ?'
            )
          ) {
            return;
          }


          await delRange(
            button.dataset.id
          );


          render();
        };
    });
}


/* =========================================================
   EDITEUR
========================================================= */

function blankRange() {

  return {

    id:
      uid('range'),

    nom:
      '',

    informations: {

      position:
        '',

      stack:
        '',

      situation:
        ''
    },

    etiquettes: [],

    mains:
      Object.fromEntries(
        allHands().map(
          hand => [
            hand,
            []
          ]
        )
      )
  };
}


function openEditor(range) {

  state.editing =
    range
      ? structuredClone(range)
      : blankRange();


  state.selectedCells.clear();

  state.view =
    'editor';

  render();
}


function syncEditorFields() {

  const range =
    state.editing;


  if (!range) {
    return;
  }


  const name =
    document.getElementById(
      'name'
    );

  const position =
    document.getElementById(
      'position'
    );

  const stack =
    document.getElementById(
      'stack'
    );

  const situation =
    document.getElementById(
      'situation'
    );


  if (name) {
    range.nom =
      name.value;
  }


  if (position) {
    range.informations.position =
      position.value;
  }


  if (stack) {
    range.informations.stack =
      stack.value;
  }


  if (situation) {
    range.informations.situation =
      situation.value;
  }
}


function renderEditor(app) {

  const range =
    state.editing;


  if (!range) {

    nav('ranges');

    return;
  }


  app.innerHTML = `

    <main class="app">

      <div class="top">

        <button
          class="btn secondary"
          id="back"
        >
          ← Retour
        </button>

        <h1>
          ${
            range.nom
              ? 'Modifier'
              : 'Nouvelle range'
          }
        </h1>

        <span></span>

      </div>


      <div class="card">

        <div class="field">

          <label>
            Nom de la range *
          </label>

          <input
            class="input"
            id="name"
            value="${esc(range.nom)}"
            placeholder="Ex. BTN Open"
          >

        </div>


        <div class="field">

          <label>
            Position
          </label>

          <input
            class="input"
            id="position"
            value="${esc(
              range.informations.position
            )}"
            placeholder="BTN, UTG, BB..."
          >

        </div>


        <div class="field">

          <label>
            Stack
          </label>

          <input
            class="input"
            id="stack"
            value="${esc(
              range.informations.stack
            )}"
            placeholder="40 BB"
          >

        </div>


        <div class="field">

          <label>
            Situation
          </label>

          <input
            class="input"
            id="situation"
            value="${esc(
              range.informations.situation
            )}"
            placeholder="Open, vs BTN, 3-bet..."
          >

        </div>

      </div>


      <div class="card">

        <div
          class="section-title"
          style="margin-top:0"
        >
          Étiquettes / actions
        </div>


        <div class="labels">

          ${
            range.etiquettes.length

              ?

              range.etiquettes
                .map(label => `

                  <div class="label-row">

                    <i
                      class="swatch"
                      style="background:${esc(
                        label.couleur
                      )}"
                    ></i>

                    <span class="grow">
                      ${esc(label.nom)}
                    </span>

                    <button
                      class="btn secondary rename"
                      data-id="${esc(label.id)}"
                    >
                      Modifier
                    </button>

                    <button
                      class="btn danger remove-label"
                      data-id="${esc(label.id)}"
                    >
                      ×
                    </button>

                  </div>

                `)
                .join('')

              :

              `

                <span class="muted">
                  Crée des étiquettes comme
                  Fold, Call, Raise, All-in…
                </span>

              `
          }

        </div>


        <button
          class="btn secondary"
          id="addLabel"
          style="margin-top:10px"
        >
          + Ajouter une étiquette
        </button>

      </div>


      <div class="card">

        <div
          class="section-title"
          style="margin-top:0"
        >
          Matrice 13 × 13
        </div>


        <p class="muted">
          Maintiens le doigt (ou le clic)
          et glisse pour sélectionner
          plusieurs mains.
        </p>


        <div
          class="matrix-wrap"
          id="matrix-wrap"
        >

          <table
            class="matrix"
            id="range-grid"
          >

            <tbody>

              ${
                Array.from(
                  {
                    length: 13
                  },
                  (_, row) => `

                    <tr>

                      ${
                        Array.from(
                          {
                            length: 13
                          },
                          (_, col) =>
                            cellHTML(
                              range,
                              row,
                              col
                            )
                        ).join('')
                      }

                    </tr>

                  `
                ).join('')
              }

            </tbody>

          </table>

        </div>


        <div
          class="selected-count"
          id="selected-count"
        >
          ${
            state.selectedCells.size
          }
          main${
            state.selectedCells.size > 1
              ? 's'
              : ''
          }
          sélectionnée${
            state.selectedCells.size > 1
              ? 's'
              : ''
          }
        </div>


        <div class="toolbar">

          <button
            class="btn secondary"
            id="clearSel"
          >
            Désélectionner
          </button>

        </div>


        <div class="matrix-labels">

          ${
            range.etiquettes
              .map(label => `

                <span>

                  <i
                    style="background:${esc(
                      label.couleur
                    )}"
                  ></i>

                  ${esc(label.nom)}

                </span>

              `)
              .join('')
          }

        </div>

      </div>


      <div class="card">

        <div
          class="section-title"
          style="margin-top:0"
        >
          Appliquer une étiquette
          aux mains sélectionnées
        </div>


        <div class="toolbar">

          ${
            range.etiquettes.length

              ?

              range.etiquettes
                .map(label => `

                  <button
                    class="btn secondary assign"
                    data-label="${esc(label.id)}"
                  >
                    Appliquer :
                    ${esc(label.nom)}
                  </button>

                `)
                .join('')

              :

              `

                <span class="muted">
                  Ajoute d’abord une étiquette.
                </span>

              `
          }

        </div>

      </div>


      <div class="sticky">

        <button
          class="btn"
          id="save"
          style="width:100%"
        >
          Enregistrer la range
        </button>

      </div>

    </main>
  `;


  document
    .getElementById(
      'back'
    )
    ?.addEventListener(
      'click',
      () => nav('ranges')
    );


  document
    .getElementById(
      'addLabel'
    )
    ?.addEventListener(
      'click',
      () => {

        syncEditorFields();

        labelModal();
      }
    );


  document
    .getElementById(
      'clearSel'
    )
    ?.addEventListener(
      'click',
      () => {

        state.selectedCells.clear();

        updateSelectedCount();

        updateGridSelectionVisuals();
      }
    );


  document
    .getElementById(
      'save'
    )
    ?.addEventListener(
      'click',
      saveRange
    );


  app
    .querySelectorAll(
      '.remove-label'
    )
    .forEach(button => {

      button.onclick = () => {

        syncEditorFields();


        range.etiquettes =
          range.etiquettes.filter(
            label =>
              label.id !==
              button.dataset.id
          );


        for (
          const hand of allHands()
        ) {

          range.mains[hand] =
            range.mains[hand]
              .filter(
                id =>
                  id !==
                  button.dataset.id
              );
        }


        render();
      };
    });


  app
    .querySelectorAll(
      '.rename'
    )
    .forEach(button => {

      button.onclick = () => {

        syncEditorFields();


        const label =
          range.etiquettes.find(
            item =>
              item.id ===
              button.dataset.id
          );


        if (label) {

          labelModal(
            label
          );
        }
      };
    });


  app
    .querySelectorAll(
      '.assign'
    )
    .forEach(button => {

      button.onclick = () => {

        applyLabel(
          button.dataset.label
        );
      };
    });


  bindGridPointerEvents();
}


function cellHTML(
  range,
  row,
  col
) {

  const hand =
    handAt(
      row,
      col
    );


  const ids =
    range.mains[hand] ||
    [];


  const labels =
    ids
      .map(
        id =>
          range.etiquettes.find(
            label =>
              label.id === id
          )
      )
      .filter(Boolean);


  let style = '';


  if (
    labels.length === 1
  ) {

    style = `

      <i
        class="single"
        style="background:${esc(
          labels[0].couleur
        )}"
      ></i>

    `;

  } else if (
    labels.length === 2
  ) {

    style = `

      <i class="split">

        <i
          style="background:${esc(
            labels[0].couleur
          )}"
        ></i>

        <i
          style="background:${esc(
            labels[1].couleur
          )}"
        ></i>

      </i>

    `;
  }


  return `

    <td>

      <button
        class="cell ${
          state.selectedCells.has(hand)
            ? 'selected'
            : ''
        }"
        data-hand="${esc(hand)}"
        type="button"
      >

        ${style}

        <span>
          ${esc(hand)}
        </span>

      </button>

    </td>

  `;
}


/* =========================================================
   SÉLECTION MATRICE
========================================================= */

function bindGridPointerEvents() {

  const grid =
    document.getElementById(
      'range-grid'
    );


  if (!grid) {
    return;
  }


  grid.onpointerdown =
    gridPointerDown;

  grid.onpointermove =
    gridPointerMove;

  grid.onpointerup =
    gridPointerUp;

  grid.onpointercancel =
    gridPointerUp;

  grid.oncontextmenu =
    event =>
      event.preventDefault();
}


function cellFromPoint(
  x,
  y
) {

  const element =
    document.elementFromPoint(
      x,
      y
    );


  return (
    element?.closest?.(
      '.cell'
    ) ||
    null
  );
}


function gridPointerDown(
  event
) {

  const cell =
    cellFromPoint(
      event.clientX,
      event.clientY
    );


  if (!cell) {
    return;
  }


  event.preventDefault();


  gridPointerActive =
    true;


  gridSelectionMode =
    !state.selectedCells.has(
      cell.dataset.hand
    );


  lastTouchedHand = null;


  selectGridCell(
    cell
  );


  try {

    event.currentTarget.setPointerCapture(
      event.pointerId
    );

  } catch (_) {}
}


function gridPointerMove(
  event
) {

  if (
    !gridPointerActive
  ) {
    return;
  }


  event.preventDefault();


  const cell =
    cellFromPoint(
      event.clientX,
      event.clientY
    );


  if (cell) {

    selectGridCell(
      cell
    );
  }
}


function gridPointerUp(
  event
) {

  if (
    !gridPointerActive
  ) {
    return;
  }


  event.preventDefault();


  gridPointerActive =
    false;

  lastTouchedHand =
    null;


  try {

    event.currentTarget.releasePointerCapture(
      event.pointerId
    );

  } catch (_) {}
}


function selectGridCell(
  cell
) {

  const hand =
    cell.dataset.hand;


  if (
    !hand ||
    hand === lastTouchedHand
  ) {
    return;
  }


  lastTouchedHand =
    hand;


  if (
    gridSelectionMode
  ) {

    state.selectedCells.add(
      hand
    );

  } else {

    state.selectedCells.delete(
      hand
    );
  }


  cell.classList.toggle(
    'selected',
    gridSelectionMode
  );


  updateSelectedCount();
}


function updateSelectedCount() {

  const element =
    document.getElementById(
      'selected-count'
    );


  if (!element) {
    return;
  }


  element.textContent =
    `${state.selectedCells.size} ` +
    `main${
      state.selectedCells.size > 1
        ? 's'
        : ''
    } ` +
    `sélectionnée${
      state.selectedCells.size > 1
        ? 's'
        : ''
    }`;
}


function updateGridSelectionVisuals() {

  document
    .querySelectorAll(
      '.cell'
    )
    .forEach(cell => {

      cell.classList.toggle(
        'selected',
        state.selectedCells.has(
          cell.dataset.hand
        )
      );
    });
}


/* =========================================================
   MODALE ÉTIQUETTE
========================================================= */

function labelModal(
  existing
) {

  const range =
    state.editing;


  if (!range) {
    return;
  }


  let color =
    existing?.couleur ||
    COLORS[
      range.etiquettes.length %
      COLORS.length
    ];


  const modalRoot =
    document.getElementById(
      'modal-root'
    );


  if (!modalRoot) {
    return;
  }


  modalRoot.innerHTML = `

    <div class="modal-backdrop">

      <div class="modal">

        <h2>
          ${
            existing
              ? 'Modifier'
              : 'Nouvelle'
          }
          étiquette
        </h2>


        <div class="field">

          <label>
            Nom
          </label>

          <input
            class="input"
            id="labelName"
            value="${esc(
              existing?.nom || ''
            )}"
            placeholder="Raise, Fold, All-in..."
          >

        </div>


        <div class="field">

          <label>
            Couleur
          </label>

          <div class="color-grid">

            ${
              COLORS
                .map(colorValue => `

                  <button
                    type="button"
                    class="color-choice ${
                      colorValue === color
                        ? 'selected'
                        : ''
                    }"
                    data-color="${colorValue}"
                    style="background:${colorValue}"
                  ></button>

                `)
                .join('')
            }

          </div>

        </div>


        <div class="toolbar">

          <button
            class="btn secondary"
            id="cancel"
          >
            Annuler
          </button>

          <button
            class="btn"
            id="ok"
          >
            Enregistrer
          </button>

        </div>

      </div>

    </div>
  `;


  modalRoot
    .querySelectorAll(
      '.color-choice'
    )
    .forEach(button => {

      button.onclick = () => {

        color =
          button.dataset.color;


        modalRoot
          .querySelectorAll(
            '.color-choice'
          )
          .forEach(item => {

            item.classList.remove(
              'selected'
            );
          });


        button.classList.add(
          'selected'
        );
      };
    });


  document
    .getElementById(
      'cancel'
    )
    ?.addEventListener(
      'click',
      () => {

        modalRoot.innerHTML =
          '';
      }
    );


  document
    .getElementById(
      'ok'
    )
    ?.addEventListener(
      'click',
      () => {

        const nameInput =
          document.getElementById(
            'labelName'
          );


        const name =
          nameInput
            ?.value
            .trim() ||
          '';


        if (!name) {
          return;
        }


        if (existing) {

          existing.nom =
            name;

          existing.couleur =
            color;

        } else {

          range.etiquettes.push({

            id:
              uid('label'),

            nom:
              name,

            couleur:
              color
          });
        }


        modalRoot.innerHTML =
          '';


        render();
      }
    );
}


function applyLabel(
  labelId
) {

  const range =
    state.editing;


  if (!range) {
    return;
  }


  syncEditorFields();


  for (
    const hand of state.selectedCells
  ) {

    let labels =
      range.mains[hand] ||
      [];


    if (
      labels.includes(
        labelId
      )
    ) {

      labels =
        labels.filter(
          id =>
            id !== labelId
        );

    } else if (
      labels.length < 2
    ) {

      labels = [
        ...labels,
        labelId
      ];
    }


    range.mains[hand] =
      labels;
  }


  state.selectedCells.clear();

  render();
}


async function saveRange() {

  syncEditorFields();


  const range =
    state.editing;


  if (
    !range ||
    !range.nom.trim()
  ) {

    alert(
      'Donne un nom à la range.'
    );

    return;
  }


  range.nom =
    range.nom.trim();


  await putRange(
    range
  );


  state.view =
    'ranges';

  state.editing =
    null;

  state.selectedCells.clear();


  render();
}


/* =========================================================
   CONFIGURATION DRILL
========================================================= */

function renderSetup(app) {

  app.innerHTML = `

    <main class="app">

      <div class="top">

        <h1>
          Nouveau drill
        </h1>

      </div>


      <div class="card">

        <div
          class="section-title"
          style="margin-top:0"
        >
          1. Choisir les ranges
        </div>


        <div
          class="toolbar"
          style="margin-bottom:12px"
        >

          <button
            class="btn secondary"
            id="selectAllRanges"
          >
            Tout sélectionner
          </button>

          <button
            class="btn secondary"
            id="clearAllRanges"
          >
            Tout désélectionner
          </button>

        </div>


        <div
          id="rangeChoices"
          class="muted"
        >
          Chargement...
        </div>

      </div>


      <div class="card">

        <div
          class="section-title"
          style="margin-top:0"
        >
          2. Nombre de mains
        </div>


        <div class="toolbar">

          ${
            [10, 20, 30, 50, 100]
              .map(
                number => `

                  <button
                    class="btn secondary len"
                    data-n="${number}"
                  >
                    ${number}
                  </button>

                `
              )
              .join('')
          }

        </div>

      </div>


      <div class="sticky">

        <button
          class="btn"
          id="start"
          style="width:100%"
        >
          Commencer
        </button>

      </div>

    </main>
  `;


  let drillLength = 20;


  getRanges()
    .then(ranges => {

      const box =
        document.getElementById(
          'rangeChoices'
        );


      if (!box) {
        return;
      }


      if (
        !ranges.length
      ) {

        box.innerHTML = `

          <div class="notice">

            Crée au moins une range
            avant de lancer un drill.

          </div>

        `;

        return;
      }


      const groups =
        groupRangesByPosition(
          ranges
        );


      box.innerHTML = `

        <div class="range-groups">

          ${
            groups
              .map(
                ([position, groupRanges]) =>
                  positionGroupHTML(
                    position,
                    groupRanges,
                    {
                      drillMode: true
                    }
                  )
              )
              .join('')
          }

        </div>
      `;


      box
        .querySelectorAll(
          '.range-group-header'
        )
        .forEach(header => {

          header.onclick = () => {

            const content =
              document.getElementById(
                header.dataset.group
              );


            if (!content) {
              return;
            }


            const arrow =
              header.querySelector(
                '.group-arrow'
              );


            content.hidden =
              !content.hidden;


            if (arrow) {

              arrow.textContent =
                content.hidden
                  ? '▶'
                  : '▼';
            }
          };
        });


      box
        .querySelectorAll(
          '.position-check'
        )
        .forEach(check => {

          check.onchange = () => {

            const position =
              check.dataset.position;


            box
              .querySelectorAll(
                '.range-check'
              )
              .forEach(rangeCheck => {

                const range =
                  ranges.find(
                    item =>
                      item.id ===
                      rangeCheck.value
                  );


                if (!range) {
                  return;
                }


                const rangePosition =
                  (
                    range
                      .informations
                      ?.position ||
                    ''
                  )
                    .trim() ||
                  'Sans position';


                if (
                  rangePosition ===
                  position
                ) {

                  rangeCheck.checked =
                    check.checked;
                }
              });
          };
        });


      box
        .querySelectorAll(
          '.range-check'
        )
        .forEach(rangeCheck => {

          rangeCheck.onchange = () => {

            const range =
              ranges.find(
                item =>
                  item.id ===
                  rangeCheck.value
              );


            if (!range) {
              return;
            }


            const position =
              (
                range
                  .informations
                  ?.position ||
                ''
              )
                .trim() ||
              'Sans position';


            const groupCheck =
              [
                ...box.querySelectorAll(
                  '.position-check'
                )
              ].find(
                item =>
                  item.dataset.position ===
                  position
              );


            if (!groupCheck) {
              return;
            }


            const groupRanges =
              ranges.filter(
                item => {

                  const itemPosition =
                    (
                      item
                        .informations
                        ?.position ||
                      ''
                    )
                      .trim() ||
                    'Sans position';


                  return (
                    itemPosition ===
                    position
                  );
                }
              );


            const allChecked =
              groupRanges.every(
                item => {

                  const checkbox =
                    box.querySelector(
                      `.range-check[value="${CSS.escape(
                        item.id
                      )}"]`
                    );

                  return (
                    checkbox?.checked
                  );
                }
              );


            groupCheck.checked =
              allChecked;
          };
        });
    })
    .catch(error => {

      console.error(
        error
      );

      const box =
        document.getElementById(
          'rangeChoices'
        );

      if (box) {

        box.innerHTML = `

          <div class="notice">
            Impossible de charger les ranges.
          </div>

        `;
      }
    });


  app
    .querySelectorAll(
      '.len'
    )
    .forEach(button => {

      button.onclick = () => {

        drillLength =
          Number(
            button.dataset.n
          );


        app
          .querySelectorAll(
            '.len'
          )
          .forEach(item => {

            item.classList.add(
              'secondary'
            );
          });


        button.classList.remove(
          'secondary'
        );
      };
    });


  document
    .getElementById(
      'selectAllRanges'
    )
    ?.addEventListener(
      'click',
      () => {

        app
          .querySelectorAll(
            '.range-check'
          )
          .forEach(
            checkbox =>
              checkbox.checked = true
          );


        app
          .querySelectorAll(
            '.position-check'
          )
          .forEach(
            checkbox =>
              checkbox.checked = true
          );
      }
    );


  document
    .getElementById(
      'clearAllRanges'
    )
    ?.addEventListener(
      'click',
      () => {

        app
          .querySelectorAll(
            '.range-check'
          )
          .forEach(
            checkbox =>
              checkbox.checked = false
          );


        app
          .querySelectorAll(
            '.position-check'
          )
          .forEach(
            checkbox =>
              checkbox.checked = false
          );
      }
    );


  document
    .getElementById(
      'start'
    )
    ?.addEventListener(
      'click',
      async () => {

        const ranges =
          await getRanges();


        const selectedIds =
          [
            ...document.querySelectorAll(
              '.range-check:checked'
            )
          ]
            .map(
              checkbox =>
                checkbox.value
            );


        const selectedRanges =
          ranges.filter(
            range =>
              selectedIds.includes(
                range.id
              )
          );


        if (
          !selectedRanges.length
        ) {

          alert(
            'Sélectionne au moins une range.'
          );

          return;
        }


        const situations =
          buildSituations(
            selectedRanges
          );


        if (
          !situations.fold.length ||
          !situations.nonFold.length
        ) {

          alert(
            'Pour respecter le ratio 30/70, les ranges sélectionnées doivent contenir au moins une situation Fold et une situation Non-Fold définies.'
          );

          return;
        }


        state.drill = {

          ranges:
            selectedRanges,

          questions:
            makeQuestions(
              situations,
              drillLength
            ),

          index:
            0,

          score:
            0,

          answers: []
        };


        state.view =
          'question';


        render();
      }
    );
}


/* =========================================================
   LOGIQUE DRILL
========================================================= */

function isFoldOnly(
  range,
  hand
) {

  const ids =
    range.mains[hand] ||
    [];


  if (!ids.length) {
    return false;
  }


  return ids.every(
    id => {

      const label =
        range.etiquettes.find(
          item =>
            item.id === id
        );


      return (
        label &&
        label.nom
          .trim()
          .toLowerCase() ===
        'fold'
      );
    }
  );
}


function buildSituations(
  ranges
) {

  const fold = [];
  const nonFold = [];


  for (
    const range of ranges
  ) {

    for (
      const hand of allHands()
    ) {

      if (
        !(range.mains[hand] || []).length
      ) {
        continue;
      }


      const labels =
        (range.mains[hand] || [])
          .map(
            id =>
              range.etiquettes.find(
                label =>
                  label.id === id
              )
          )
          .filter(Boolean);


      const situation = {

        rangeId:
          range.id,

        range:
          range,

        main:
          hand,

        labels:
          labels
      };


      if (
        isFoldOnly(
          range,
          hand
        )
      ) {

        fold.push(
          situation
        );

      } else {

        nonFold.push(
          situation
        );
      }
    }
  }


  return {
    fold,
    nonFold
  };
}


function sample(
  array,
  count
) {

  if (
    !array.length ||
    count <= 0
  ) {

    return [];
  }


  const pool =
    [...array];

  const result = [];


  for (
    let i = 0;
    i < count;
    i++
  ) {

    if (
      !pool.length
    ) {

      pool.push(
        ...array
      );
    }


    const index =
      Math.floor(
        Math.random() *
        pool.length
      );


    result.push(
      pool.splice(
        index,
        1
      )[0]
    );
  }


  return result;
}


function makeQuestions(
  situations,
  length
) {

  const foldCount =
    Math.round(
      length * 0.3
    );


  const nonFoldCount =
    length -
    foldCount;


  const questions = [

    ...sample(
      situations.fold,
      foldCount
    ),

    ...sample(
      situations.nonFold,
      nonFoldCount
    )

  ];


  for (
    let i = questions.length - 1;
    i > 0;
    i--
  ) {

    const j =
      Math.floor(
        Math.random() *
        (i + 1)
      );


    [
      questions[i],
      questions[j]
    ] = [
      questions[j],
      questions[i]
    ];
  }


  return questions;
}


/* =========================================================
   QUESTIONS
========================================================= */

function renderDrill(app) {

  const drill =
    state.drill;


  if (!drill) {

    state.view =
      'setup';

    renderSetup(app);

    return;
  }


  if (
    state.view === 'result'
  ) {

    renderResult(app);

    return;
  }


  const question =
    drill.questions[
      drill.index
    ];


  if (!question) {

    finishDrill();

    return;
  }


  const multipleRanges =
    drill.ranges.length > 1;


  const optionMap =
    new Map();


  for (
    const range of drill.ranges
  ) {

    for (
      const label of range.etiquettes
    ) {

      const name =
        label.nom.trim();


      if (
        name
      ) {

        optionMap.set(
          name,
          name
        );
      }
    }
  }


  const options =
    [
      ...optionMap.values()
    ];


  for (
    let i = options.length - 1;
    i > 0;
    i--
  ) {

    const j =
      Math.floor(
        Math.random() *
        (i + 1)
      );


    [
      options[i],
      options[j]
    ] = [
      options[j],
      options[i]
    ];
  }


  app.innerHTML = `

    <main class="app">

      <div class="muted">

        Question
        ${drill.index + 1}
        /
        ${drill.questions.length}

      </div>


      <div class="progress">

        <i
          style="
            width:${
              (
                drill.index /
                drill.questions.length
              ) * 100
            }%
          "
        ></i>

      </div>


      ${
        multipleRanges

          ?

          `

            <div class="context">
              ${esc(question.range.nom)}
            </div>

          `

          :

          ''
      }


      <div class="drill-hand">
        ${esc(question.main)}
      </div>


      <div class="answers">

        ${
          options
            .map(option => {

              const label =
                question.range.etiquettes.find(
                  item =>
                    item.nom.trim() ===
                    option
                );


              return `

                <button
                  class="btn answer"
                  data-answer="${esc(option)}"
                  style="
                    --answer-border:
                    ${esc(
                      label?.couleur ||
                      '#d7d7d1'
                    )}
                  "
                >
                  ${esc(option)}
                </button>

              `;
            })
            .join('')
        }

      </div>


      <div id="feedback"></div>

    </main>
  `;


  app
    .querySelectorAll(
      '.answer'
    )
    .forEach(button => {

      button.onclick = () => {

        answer(
          question,
          button.dataset.answer
        );
      };
    });
}


function answer(
  question,
  answerValue
) {

  const correct =
    question.labels.some(
      label =>
        label.nom.trim() ===
        answerValue
    );


  const drill =
    state.drill;


  if (correct) {
    drill.score++;
  }


  drill.answers.push({

    rangeId:
      question.rangeId,

    main:
      question.main,

    answer:
      answerValue,

    correct:
      correct,

    correctAnswers:
      question.labels.map(
        label =>
          label.nom
      )
  });


  document
    .querySelectorAll(
      '.answer'
    )
    .forEach(button => {

      button.disabled =
        true;
    });


  const feedback =
    document.getElementById(
      'feedback'
    );


  if (!feedback) {
    return;
  }


  feedback.innerHTML = `

    <div
      class="feedback ${
        correct
          ? 'correct'
          : 'wrong'
      }"
    >

      <b>
        ${
          correct
            ? '✓ Correct'
            : '✗ Incorrect'
        }
      </b>

      <br>

      Bonne réponse :

      <b>
        ${
          esc(
            question.labels
              .map(
                label =>
                  label.nom
              )
              .join(' + ')
          )
        }
      </b>

    </div>


    <button
      class="btn"
      id="next"
      style="width:100%"
    >
      ${
        drill.index + 1 <
        drill.questions.length
          ? 'Suivant'
          : 'Voir le résultat'
      }
    </button>

  `;


  document
    .getElementById(
      'next'
    )
    ?.addEventListener(
      'click',
      () => {

        if (
          drill.index + 1 <
          drill.questions.length
        ) {

          drill.index++;

          state.view =
            'question';

          render();

        } else {

          finishDrill();
        }
      }
    );
}


/* =========================================================
   FIN DRILL
========================================================= */

async function finishDrill() {

  const drill =
    state.drill;


  if (!drill) {
    return;
  }


  await addHistory({

    id:
      uid('drill'),

    date:
      new Date().toISOString(),

    score:
      drill.score,

    total:
      drill.questions.length,

    answers:
      drill.answers,

    ranges:
      drill.ranges.map(
        range =>
          range.id
      )
  });


  await trimHistory();


  state.view =
    'result';


  render();
}


/* =========================================================
   RESULTAT
========================================================= */

function renderResult(app) {

  const drill =
    state.drill;


  if (!drill) {

    nav('setup');

    return;
  }


  const percentage =
    drill.questions.length
      ? Math.round(
          drill.score /
          drill.questions.length *
          100
        )
      : 0;


  const errors =
    drill.questions.length -
    drill.score;


  app.innerHTML = `

    <main class="app">

      <div class="card result">

        <div class="muted">
          Drill terminé
        </div>


        <div class="score">
          ${percentage}%
        </div>


        <div class="big">

          ${drill.score}
          /
          ${drill.questions.length}

        </div>


        <p>

          <b>
            ${percentage} % de réussite
          </b>

        </p>


        <p>

          ${errors}
          erreur${errors > 1 ? 's' : ''}

        </p>

      </div>


      <button
        class="btn"
        id="retry"
        style="
          width:100%;
          margin-bottom:9px
        "
      >
        Refaire le drill
      </button>


      <button
        class="btn secondary"
        id="home"
        style="width:100%"
      >
        Retour aux ranges
      </button>

    </main>
  `;


  document
    .getElementById(
      'retry'
    )
    ?.addEventListener(
      'click',
      () => {

        const situations =
          buildSituations(
            drill.ranges
          );


        drill.questions =
          makeQuestions(
            situations,
            drill.questions.length
          );


        drill.index =
          0;

        drill.score =
          0;

        drill.answers =
          [];


        state.view =
          'question';


        render();
      }
    );


  document
    .getElementById(
      'home'
    )
    ?.addEventListener(
      'click',
      () => {

        state.drill =
          null;

        nav('ranges');
      }
    );
}


/* =========================================================
   NAVIGATION GLOBALE
========================================================= */

/*
  Délégation sur document :

  Cela évite que les boutons RANGES / DRILL
  cessent de fonctionner après un changement
  de contenu de #app.
*/

document.addEventListener(
  'click',
  event => {

    const button =
      event.target.closest(
        '[data-nav]'
      );


    if (!button) {
      return;
    }


    const target =
      button.dataset.nav;


    if (!target) {
      return;
    }


    event.preventDefault();

    nav(target);
  }
);


/*
  Protection de la matrice contre
  les comportements tactiles du navigateur.
*/

document.addEventListener(
  'pointerdown',
  event => {

    if (
      event.target.closest(
        '.matrix-wrap'
      )
    ) {

      event.preventDefault();
    }
  },
  {
    passive: false
  }
);


/* =========================================================
   DÉMARRAGE
========================================================= */

init().catch(error => {

  console.error(
    'Erreur de démarrage :',
    error
  );


  const app =
    document.getElementById(
      'app'
    );


  if (!app) {
    return;
  }


  app.innerHTML = `

    <main class="app">

      <div class="card">

        <b>
          Erreur de démarrage.
        </b>

        <p>
          Ton navigateur ne semble pas
          autoriser IndexedDB.
        </p>

        <p class="muted">
          Ouvre la console du navigateur
          pour voir le détail de l'erreur.
        </p>

      </div>

    </main>

  `;
});
