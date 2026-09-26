const RANKS=['A','K','Q','J','T','9','8','7','6','5','4','3','2'];

const COLORS=[
  '#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#06b6d4',
  '#3b82f6','#6366f1','#8b5cf6','#ec4899','#64748b','#111827','#F8F8F6'
];

const DB_NAME='PokerRangeDrill';
const DB_VERSION=1;

let db;

const state={
  view:'ranges',
  editing:null,
  selectedCells:new Set(),
  drill:null
};

let gridPointerActive=false;
let gridSelectionMode=true;
let lastTouchedHand=null;


/* =========================================================
   OUTILS
========================================================= */

function uid(prefix){
  return prefix+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7);
}

function handAt(r,c){
  if(r===c)return RANKS[r]+RANKS[c];

  return r<c
    ? RANKS[r]+RANKS[c]+'s'
    : RANKS[c]+RANKS[r]+'o';
}

function allHands(){
  const a=[];

  for(let r=0;r<13;r++){
    for(let c=0;c<13;c++){
      a.push(handAt(r,c));
    }
  }

  return a;
}

function esc(s){
  return String(s??'').replace(
    /[&<>"']/g,
    m=>({
      '&':'&amp;',
      '<':'&lt;',
      '>':'&gt;',
      '"':'&quot;',
      "'":'&#039;'
    }[m])
  );
}


/* =========================================================
   INDEXEDDB
========================================================= */

function openDB(){
  return new Promise((res,rej)=>{

    const req=indexedDB.open(DB_NAME,DB_VERSION);

    req.onupgradeneeded=()=>{
      const d=req.result;

      if(!d.objectStoreNames.contains('ranges')){
        d.createObjectStore('ranges',{keyPath:'id'});
      }

      if(!d.objectStoreNames.contains('history')){
        d.createObjectStore('history',{keyPath:'id'});
      }
    };

    req.onsuccess=()=>{
      db=req.result;
      res();
    };

    req.onerror=()=>{
      rej(req.error);
    };
  });
}

function tx(store,mode='readonly'){
  return db.transaction(store,mode).objectStore(store);
}

function getRanges(){
  return new Promise((res,rej)=>{

    const q=tx('ranges').getAll();

    q.onsuccess=()=>{
      res(q.result);
    };

    q.onerror=()=>{
      rej(q.error);
    };
  });
}

function putRange(r){
  return new Promise((res,rej)=>{

    const q=tx('ranges','readwrite').put(r);

    q.onsuccess=()=>{
      res();
    };

    q.onerror=()=>{
      rej(q.error);
    };
  });
}

function delRange(id){
  return new Promise((res,rej)=>{

    const q=tx('ranges','readwrite').delete(id);

    q.onsuccess=()=>{
      res();
    };

    q.onerror=()=>{
      rej(q.error);
    };
  });
}

function getHistory(){
  return new Promise((res,rej)=>{

    const q=tx('history').getAll();

    q.onsuccess=()=>{
      res(q.result);
    };

    q.onerror=()=>{
      rej(q.error);
    };
  });
}

function addHistory(h){
  return new Promise((res,rej)=>{

    const q=tx('history','readwrite').put(h);

    q.onsuccess=()=>{
      res();
    };

    q.onerror=()=>{
      rej(q.error);
    };
  });
}

function deleteHistory(id){
  return new Promise((res,rej)=>{

    const q=tx('history','readwrite').delete(id);

    q.onsuccess=()=>{
      res();
    };

    q.onerror=()=>{
      rej(q.error);
    };
  });
}

async function trimHistory(){

  const hs=(await getHistory())
    .sort((a,b)=>new Date(b.date)-new Date(a.date));

  for(const h of hs.slice(5)){
    await deleteHistory(h.id);
  }
}


/* =========================================================
   INITIALISATION
========================================================= */

async function init(){

  await openDB();

  if('serviceWorker' in navigator){
    navigator.serviceWorker
      .register('./service-worker.js')
      .catch(()=>{});
  }

  render();
}


/* =========================================================
   NAVIGATION
========================================================= */

function nav(v){

  state.view=v;
  state.editing=null;
  state.selectedCells.clear();

  render();
}

function render(){

  document
    .querySelectorAll('.bottom-nav button')
    .forEach(b=>{

      b.classList.toggle(
        'active',
        b.dataset.nav===state.view ||
        (
          state.view==='editor' &&
          b.dataset.nav==='ranges'
        ) ||
        (
          ['question','result','setup'].includes(state.view) &&
          b.dataset.nav==='drill'
        )
      );
    });

  const app=document.getElementById('app');

  if(state.view==='ranges'){
    renderRanges(app);
  }
  else if(state.view==='editor'){
    renderEditor(app);
  }
  else if(state.view==='setup'){
    renderSetup(app);
  }
  else{
    renderDrill(app);
  }
}


/* =========================================================
   GROUPES DE RANGES
========================================================= */

function groupRangesByPosition(ranges){

  const groups={};

  for(const r of ranges){

    const position=
      (r.informations?.position || '').trim() ||
      'Sans position';

    if(!groups[position]){
      groups[position]=[];
    }

    groups[position].push(r);
  }

  const order=[
    'UTG',
    'HJ',
    'CO',
    'BTN',
    'SB',
    'BB',
    'Sans position'
  ];

  return Object.entries(groups).sort(([a],[b])=>{

    const ia=order.indexOf(a);
    const ib=order.indexOf(b);

    if(ia!==-1 && ib!==-1){
      return ia-ib;
    }

    if(ia!==-1){
      return -1;
    }

    if(ib!==-1){
      return 1;
    }

    return a.localeCompare(b,'fr');
  });
}

function positionGroupHTML(position,ranges,options={}){

  const drillMode=options.drillMode||false;

  const groupId=
    'group_'+position
      .replace(/[^a-zA-Z0-9]/g,'_');

  if(drillMode){

    return `
      <section class="range-group">

        <div
          class="range-group-header"
          data-group="${esc(groupId)}"
        >

          <div class="group-title">

            <span class="group-arrow">▶</span>

            <b>${esc(position)}</b>

            <span class="muted">
              · ${ranges.length}
              range${ranges.length>1?'s':''}
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

          ${ranges.map(r=>`

            <label class="check-row drill-range-row">

              <input
                type="checkbox"
                class="range-check"
                value="${esc(r.id)}"
              >

              <span class="grow">

                <b>${esc(r.nom)}</b>

                <br>

                <small class="muted">
                  ${
                    Object
                      .values(r.mains)
                      .filter(x=>x.length)
                      .length
                  }/169 définies
                </small>

              </span>

            </label>

          `).join('')}

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

          <span class="group-arrow">▶</span>

          <b>${esc(position)}</b>

          <span class="muted">
            · ${ranges.length}
            range${ranges.length>1?'s':''}
          </span>

        </div>

      </div>

      <div
        class="range-group-content"
        id="${esc(groupId)}"
        hidden
      >

        ${ranges.map(r=>`

          <section class="card range-card">

            <div class="range-main">

              <div class="range-name">
                ${esc(r.nom)}
              </div>

              <div class="chips">

                ${
                  r.informations?.position
                  ? `
                    <span class="chip">
                      ${esc(r.informations.position)}
                    </span>
                  `
                  : ''
                }

                ${
                  r.informations?.stack
                  ? `
                    <span class="chip">
                      ${esc(r.informations.stack)}
                    </span>
                  `
                  : ''
                }

                ${
                  r.informations?.situation
                  ? `
                    <span class="chip">
                      ${esc(r.informations.situation)}
                    </span>
                  `
                  : ''
                }

                <span class="chip">
                  ${
                    Object
                      .values(r.mains)
                      .filter(x=>x.length)
                      .length
                  }/169
                </span>

              </div>

            </div>

            <div class="actions">

              <button
                class="btn secondary edit"
                data-id="${esc(r.id)}"
              >
                Modifier
              </button>

              <button
                class="btn danger delete"
                data-id="${esc(r.id)}"
              >
                ×
              </button>

            </div>

          </section>

        `).join('')}

      </div>

    </section>
  `;
}


/* =========================================================
   EXPORT
========================================================= */

function downloadJSON(data,filename){

  const blob=new Blob(
    [JSON.stringify(data,null,2)],
    {
      type:'application/json'
    }
  );

  const url=URL.createObjectURL(blob);

  const a=document.createElement('a');

  a.href=url;
  a.download=filename;

  document.body.appendChild(a);

  a.click();

  a.remove();

  URL.revokeObjectURL(url);
}

async function exportRanges(){

  const ranges=await getRanges();

  if(!ranges.length){

    alert('Aucune range à exporter.');

    return;
  }

  const backup={
    app:'PokerRangeDrill',
    version:1,
    exportedAt:new Date().toISOString(),
    ranges:ranges
  };

  downloadJSON(
    backup,
    'poker-range-drill-backup.json'
  );
}


/* =========================================================
   IMPORT
========================================================= */

function normalizeImportedRange(r){

  if(!r || typeof r!=='object'){
    return null;
  }

  if(typeof r.nom!=='string'){
    return null;
  }

  if(
    !r.informations ||
    typeof r.informations!=='object'
  ){
    return null;
  }

  if(!Array.isArray(r.etiquettes)){
    return null;
  }

  if(
    !r.mains ||
    typeof r.mains!=='object'
  ){
    return null;
  }

  const range={

    id:
      typeof r.id==='string' && r.id
        ? r.id
        : uid('range'),

    nom:r.nom,

    informations:{
      position:String(
        r.informations.position ?? ''
      ),

      stack:String(
        r.informations.stack ?? ''
      ),

      situation:String(
        r.informations.situation ?? ''
      )
    },

    etiquettes:[],

    mains:Object.fromEntries(
      allHands().map(h=>[h,[]])
    )
  };

  const labelIds=new Set();

  for(const label of r.etiquettes){

    if(
      !label ||
      typeof label.nom!=='string' ||
      !label.nom.trim()
    ){
      continue;
    }

    const id=
      typeof label.id==='string' && label.id
        ? label.id
        : uid('label');

    if(labelIds.has(id)){
      continue;
    }

    labelIds.add(id);

    range.etiquettes.push({

      id:id,

      nom:label.nom,

      couleur:
        typeof label.couleur==='string'
          ? label.couleur
          : '#111827'

    });
  }

  const validLabels=new Set(
    range.etiquettes.map(l=>l.id)
  );

  for(const h of allHands()){

    const values=
      Array.isArray(r.mains[h])
        ? r.mains[h]
        : [];

    range.mains[h]=values
      .filter(id=>validLabels.has(id))
      .slice(0,2);
  }

  return range;
}

async function importRangesFromFile(file,mode){

  let data;

  try{

    const text=await file.text();

    data=JSON.parse(text);

  }catch(e){

    alert(
      'Le fichier sélectionné n’est pas un fichier JSON valide.'
    );

    return;
  }

  const imported=
    Array.isArray(data)
      ? data
      : data?.ranges;

  if(!Array.isArray(imported)){

    alert(
      'Ce fichier ne contient pas de ranges PokerRangeDrill.'
    );

    return;
  }

  const ranges=
    imported
      .map(normalizeImportedRange)
      .filter(Boolean);

  if(!ranges.length){

    alert(
      'Aucune range valide n’a été trouvée dans le fichier.'
    );

    return;
  }

  const existing=await getRanges();

  const existingIds=new Set(
    existing.map(r=>r.id)
  );

  let added=0;
  let replaced=0;
  let skipped=0;
  let duplicated=0;

  for(const range of ranges){

    if(!existingIds.has(range.id)){

      await putRange(range);

      existingIds.add(range.id);

      added++;

      continue;
    }

    if(mode==='replace'){

      await putRange(range);

      replaced++;

    }
    else if(mode==='keep'){

      skipped++;

    }
    else if(mode==='duplicate'){

      const copy=structuredClone(range);

      copy.id=uid('range');

      await putRange(copy);

      duplicated++;
    }
  }

  render();

  alert(
    `Import terminé.\n\n`+
    `Nouvelles ranges : ${added}\n`+
    `Ranges remplacées : ${replaced}\n`+
    `Ranges conservées : ${skipped}\n`+
    `Copies créées : ${duplicated}`
  );
}

async function openImportMode(file){

  const existing=await getRanges();

  if(!existing.length){

    await importRangesFromFile(
      file,
      'keep'
    );

    return;
  }

  const choice=prompt(
    `Des ranges existent déjà dans l'application.\n\n`+
    `Que veux-tu faire lorsqu'une range importée possède le même identifiant ?\n\n`+
    `1 = Remplacer la range existante\n`+
    `2 = Conserver la range existante\n`+
    `3 = Garder les deux\n\n`+
    `Entre 1, 2 ou 3.`
  );

  if(choice==='1'){

    await importRangesFromFile(
      file,
      'replace'
    );

  }
  else if(choice==='2'){

    await importRangesFromFile(
      file,
      'keep'
    );

  }
  else if(choice==='3'){

    await importRangesFromFile(
      file,
      'duplicate'
    );

  }
  else{

    alert('Import annulé.');
  }
}

function importRanges(){

  const input=document.createElement('input');

  input.type='file';
  input.accept='.json,application/json';

  input.onchange=()=>{

    const file=input.files?.[0];

    if(!file){
      return;
    }

    openImportMode(file);
  };

  input.click();
}


/* =========================================================
   MES RANGES
========================================================= */

async function renderRanges(app){

  const rs=await getRanges();

  const hs=
    (await getHistory())
      .sort(
        (a,b)=>new Date(b.date)-new Date(a.date)
      );

  const groups=
    groupRangesByPosition(rs);

  app.innerHTML=`

    <main class="app">

      <div class="top">

        <h1>Mes ranges</h1>

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
          ↑ Importer des ranges
        </button>

      </div>

      ${
        rs.length
        ?
        `
          <div class="range-groups">

            ${
              groups
                .map(
                  ([position,ranges])=>
                    positionGroupHTML(
                      position,
                      ranges
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
              Crée ta première range pour commencer tes drills.
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
          hs.length
          ?
          hs.map(h=>{

            const pct=
              Math.round(
                h.score/h.total*100
              );

            const d=new Date(h.date);

            return `

              <div class="history-item">

                <div class="history-main">

                  <div>

                    <b>
                      ${d.toLocaleDateString('fr-FR')}
                      à
                      ${d.toLocaleTimeString(
                        'fr-FR',
                        {
                          hour:'2-digit',
                          minute:'2-digit'
                        }
                      )}
                    </b>

                    <br>

                    <span class="muted">
                      ${h.total} mains
                    </span>

                  </div>

                  <div class="history-score">
                    ${h.score}/${h.total}
                  </div>

                </div>

                <div>
                  <b>${pct} % de réussite</b>
                </div>

              </div>

            `;

          }).join('')
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
    .getElementById('newRange')
    ?.addEventListener(
      'click',
      ()=>openEditor()
    );


  document
    .getElementById('emptyNew')
    ?.addEventListener(
      'click',
      ()=>openEditor()
    );


  document
    .getElementById('exportRanges')
    ?.addEventListener(
      'click',
      exportRanges
    );


  document
    .getElementById('importRanges')
    ?.addEventListener(
      'click',
      importRanges
    );


  app
    .querySelectorAll('.range-group-header')
    .forEach(header=>{

      header.onclick=()=>{

        const content=
          document.getElementById(
            header.dataset.group
          );

        if(!content){
          return;
        }

        const arrow=
          header.querySelector(
            '.group-arrow'
          );

        content.hidden=
          !content.hidden;

        if(arrow){

          arrow.textContent=
            content.hidden
              ? '▶'
              : '▼';
        }
      };
    });


  app
    .querySelectorAll('.edit')
    .forEach(b=>{

      b.onclick=async e=>{

        e.stopPropagation();

        const ranges=
          await getRanges();

        openEditor(
          ranges.find(
            r=>r.id===b.dataset.id
          )
        );
      };
    });


  app
    .querySelectorAll('.delete')
    .forEach(b=>{

      b.onclick=async e=>{

        e.stopPropagation();

        if(
          confirm(
            'Supprimer cette range ?'
          )
        ){

          await delRange(
            b.dataset.id
          );

          render();
        }
      };
    });
}


/* =========================================================
   EDITEUR DE RANGE
========================================================= */

function blankRange(){

  return {

    id:uid('range'),

    nom:'',

    informations:{
      position:'',
      stack:'',
      situation:''
    },

    etiquettes:[],

    mains:Object.fromEntries(
      allHands().map(
        h=>[h,[]]
      )
    )
  };
}

async function openEditor(range){

  state.editing=
    range
      ? structuredClone(range)
      : blankRange();

  state.selectedCells.clear();

  state.view='editor';

  render();
}

function syncEditorFields(){

  const r=state.editing;

  if(!r){
    return;
  }

  r.nom=
    document.getElementById('name')?.value
    ?? r.nom;

  r.informations.position=
    document.getElementById('position')?.value
    ?? r.informations.position;

  r.informations.stack=
    document.getElementById('stack')?.value
    ?? r.informations.stack;

  r.informations.situation=
    document.getElementById('situation')?.value
    ?? r.informations.situation;
}

function renderEditor(app){

  const r=state.editing;

  app.innerHTML=`

    <main class="app">

      <div class="top">

        <button
          class="btn secondary"
          id="back"
        >
          ← Retour
        </button>

        <h1>
          ${r.nom?'Modifier':'Nouvelle range'}
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
            value="${esc(r.nom)}"
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
              r.informations.position
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
              r.informations.stack
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
              r.informations.situation
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
            r.etiquettes.map(l=>`

              <div class="label-row">

                <i
                  class="swatch"
                  style="background:${l.couleur}"
                ></i>

                <span class="grow">
                  ${esc(l.nom)}
                </span>

                <button
                  class="btn secondary rename"
                  data-id="${l.id}"
                >
                  Modifier
                </button>

                <button
                  class="btn danger remove-label"
                  data-id="${l.id}"
                >
                  ×
                </button>

              </div>

            `).join('')
            ||
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
                  {length:13},
                  (_,row)=>`

                    <tr>

                      ${
                        Array.from(
                          {length:13},
                          (_,col)=>
                            cellHTML(
                              r,
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
          ${state.selectedCells.size}
          main${state.selectedCells.size>1?'s':''}
          sélectionnée${state.selectedCells.size>1?'s':''}
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
            r.etiquettes.map(l=>`

              <span>

                <i
                  style="background:${l.couleur}"
                ></i>

                ${esc(l.nom)}

              </span>

            `).join('')
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
            r.etiquettes.map(l=>`

              <button
                class="btn secondary assign"
                data-label="${l.id}"
              >
                Appliquer :
                ${esc(l.nom)}
              </button>

            `).join('')
            ||
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
    .getElementById('back')
    .onclick=()=>nav('ranges');


  document
    .getElementById('addLabel')
    .onclick=()=>{
      syncEditorFields();
      labelModal();
    };


  document
    .getElementById('clearSel')
    .onclick=()=>{
      state.selectedCells.clear();
      updateSelectedCount();
      updateGridSelectionVisuals();
    };


  document
    .getElementById('save')
    .onclick=saveRange;


  app
    .querySelectorAll('.remove-label')
    .forEach(b=>{

      b.onclick=()=>{

        syncEditorFields();

        r.etiquettes=
          r.etiquettes.filter(
            l=>l.id!==b.dataset.id
          );

        for(const h of allHands()){

          r.mains[h]=
            r.mains[h].filter(
              x=>x!==b.dataset.id
            );
        }

        render();
      };
    });


  app
    .querySelectorAll('.rename')
    .forEach(b=>{

      b.onclick=()=>{

        syncEditorFields();

        labelModal(
          r.etiquettes.find(
            l=>l.id===b.dataset.id
          )
        );
      };
    });


  app
    .querySelectorAll('.assign')
    .forEach(b=>{

      b.onclick=()=>{
        applyLabel(
          b.dataset.label
        );
      };
    });


  bindGridPointerEvents();
}

function cellHTML(r,row,col){

  const h=handAt(row,col);

  const ids=
    r.mains[h]||[];

  const labels=
    ids
      .map(
        id=>r.etiquettes.find(
          l=>l.id===id
        )
      )
      .filter(Boolean);

  const style=
    labels.length===1
      ?
      `
        <i
          class="single"
          style="background:${labels[0].couleur}"
        ></i>
      `
      :
      labels.length===2
      ?
      `
        <i class="split">

          <i
            style="background:${labels[0].couleur}"
          ></i>

          <i
            style="background:${labels[1].couleur}"
          ></i>

        </i>
      `
      :
      '';

  return `
    <td>

      <button
        class="cell ${
          state.selectedCells.has(h)
            ? 'selected'
            : ''
        }"
        data-hand="${h}"
        type="button"
      >

        ${style}

        <span>
          ${h}
        </span>

      </button>

    </td>
  `;
}


/* =========================================================
   SÉLECTION MATRICE
========================================================= */

function bindGridPointerEvents(){

  const grid=
    document.getElementById(
      'range-grid'
    );

  if(!grid){
    return;
  }

  grid.onpointerdown=
    gridPointerDown;

  grid.onpointermove=
    gridPointerMove;

  grid.onpointerup=
    gridPointerUp;

  grid.onpointercancel=
    gridPointerUp;

  grid.onpointerleave=()=>{};

  grid.oncontextmenu=
    e=>e.preventDefault();
}

function cellFromPoint(x,y){

  const el=
    document.elementFromPoint(
      x,
      y
    );

  return el?.closest?.('.cell')||null;
}

function gridPointerDown(e){

  const cell=
    cellFromPoint(
      e.clientX,
      e.clientY
    );

  if(!cell){
    return;
  }

  e.preventDefault();

  gridPointerActive=true;

  gridSelectionMode=
    !state.selectedCells.has(
      cell.dataset.hand
    );

  lastTouchedHand=null;

  selectGridCell(cell);

  try{

    e.currentTarget.setPointerCapture(
      e.pointerId
    );

  }catch(_){}
}

function gridPointerMove(e){

  if(!gridPointerActive){
    return;
  }

  e.preventDefault();

  const cell=
    cellFromPoint(
      e.clientX,
      e.clientY
    );

  if(cell){
    selectGridCell(cell);
  }
}

function gridPointerUp(e){

  if(!gridPointerActive){
    return;
  }

  e.preventDefault();

  gridPointerActive=false;
  lastTouchedHand=null;

  try{

    e.currentTarget.releasePointerCapture(
      e.pointerId
    );

  }catch(_){}
}

function selectGridCell(cell){

  const h=cell.dataset.hand;

  if(
    !h ||
    h===lastTouchedHand
  ){
    return;
  }

  lastTouchedHand=h;

  if(gridSelectionMode){

    state.selectedCells.add(h);

  }else{

    state.selectedCells.delete(h);
  }

  cell.classList.toggle(
    'selected',
    gridSelectionMode
  );

  updateSelectedCount();
}

function updateSelectedCount(){

  const el=
    document.getElementById(
      'selected-count'
    );

  if(el){

    el.textContent=
      `${state.selectedCells.size} `+
      `main${state.selectedCells.size>1?'s':''} `+
      `sélectionnée${state.selectedCells.size>1?'s':''}`;
  }
}

function updateGridSelectionVisuals(){

  document
    .querySelectorAll('.cell')
    .forEach(cell=>{

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

function labelModal(existing){

  const r=state.editing;

  let color=
    existing?.couleur ||
    COLORS[
      r.etiquettes.length %
      COLORS.length
    ];

  document
    .getElementById('modal-root')
    .innerHTML=`

      <div class="modal-backdrop">

        <div class="modal">

          <h2>
            ${existing?'Modifier':'Nouvelle'}
            étiquette
          </h2>


          <div class="field">

            <label>
              Nom
            </label>

            <input
              class="input"
              id="labelName"
              value="${esc(existing?.nom||'')}"
              placeholder="Raise, Fold, All-in..."
            >

          </div>


          <div class="field">

            <label>
              Couleur
            </label>

            <div class="color-grid">

              ${
                COLORS.map(c=>`

                  <button
                    type="button"
                    class="color-choice ${
                      c===color
                        ? 'selected'
                        : ''
                    }"
                    data-color="${c}"
                    style="background:${c}"
                  ></button>

                `).join('')
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


  document
    .querySelectorAll('.color-choice')
    .forEach(b=>{

      b.onclick=()=>{

        color=b.dataset.color;

        document
          .querySelectorAll('.color-choice')
          .forEach(x=>
            x.classList.remove('selected')
          );

        b.classList.add('selected');
      };
    });


  document
    .getElementById('cancel')
    .onclick=()=>{
      document
        .getElementById('modal-root')
        .innerHTML='';
    };


  document
    .getElementById('ok')
    .onclick=()=>{

      const n=
        document
          .getElementById('labelName')
          .value
          .trim();

      if(!n){
        return;
      }

      if(existing){

        existing.nom=n;
        existing.couleur=color;

      }else{

        r.etiquettes.push({
          id:uid('label'),
          nom:n,
          couleur:color
        });
      }

      document
        .getElementById('modal-root')
        .innerHTML='';

      render();
    };
}

function applyLabel(id){

  const r=state.editing;

  syncEditorFields();

  for(const h of state.selectedCells){

    let a=
      r.mains[h]||[];

    if(a.includes(id)){

      a=a.filter(
        x=>x!==id
      );

    }
    else if(a.length<2){

      a=[
        ...a,
        id
      ];
    }

    r.mains[h]=a;
  }

  state.selectedCells.clear();

  render();
}

async function saveRange(){

  syncEditorFields();

  const r=state.editing;

  if(!r.nom){

    alert(
      'Donne un nom à la range.'
    );

    return;
  }

  await putRange(r);

  state.view='ranges';
  state.editing=null;

  render();
}


/* =========================================================
   CONFIGURATION DU DRILL
========================================================= */

function renderSetup(app){

  app.innerHTML=`

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
            [10,20,30,50,100]
              .map(n=>`

                <button
                  class="btn secondary len"
                  data-n="${n}"
                >
                  ${n}
                </button>

              `).join('')
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


  getRanges().then(rs=>{

    const box=
      document.getElementById(
        'rangeChoices'
      );

    if(!box){
      return;
    }

    if(!rs.length){

      box.innerHTML=`

        <div class="notice">
          Crée au moins une range
          avant de lancer un drill.
        </div>

      `;

      return;
    }

    const groups=
      groupRangesByPosition(rs);

    box.innerHTML=`

      <div class="range-groups">

        ${
          groups
            .map(
              ([position,ranges])=>
                positionGroupHTML(
                  position,
                  ranges,
                  {
                    drillMode:true
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
      .forEach(header=>{

        header.onclick=()=>{

          const content=
            document.getElementById(
              header.dataset.group
            );

          if(!content){
            return;
          }

          const arrow=
            header.querySelector(
              '.group-arrow'
            );

          content.hidden=
            !content.hidden;

          if(arrow){

            arrow.textContent=
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
      .forEach(check=>{

        check.onchange=()=>{

          const position=
            check.dataset.position;

          box
            .querySelectorAll(
              '.range-check'
            )
            .forEach(rangeCheck=>{

              const range=
                rs.find(
                  r=>r.id===rangeCheck.value
                );

              if(!range){
                return;
              }

              const rangePosition=
                (
                  range
                    .informations
                    ?.position ||
                  ''
                )
                .trim() ||
                'Sans position';

              if(
                rangePosition===
                position
              ){

                rangeCheck.checked=
                  check.checked;
              }

            });
        };
      });


    box
      .querySelectorAll('.range-check')
      .forEach(rangeCheck=>{

        rangeCheck.onchange=()=>{

          const range=
            rs.find(
              r=>r.id===rangeCheck.value
            );

          if(!range){
            return;
          }

          const position=
            (
              range
                .informations
                ?.position ||
              ''
            )
            .trim() ||
            'Sans position';

          const groupChecks=
            [
              ...box.querySelectorAll(
                '.position-check'
              )
            ];

          const groupCheck=
            groupChecks.find(
              c=>
                c.dataset.position===
                position
            );

          if(!groupCheck){
            return;
          }

          const groupRanges=
            rs.filter(r=>{

              const p=
                (
                  r
                    .informations
                    ?.position ||
                  ''
                )
                .trim() ||
                'Sans position';

              return p===position;
            });

          const allChecked=
            groupRanges.every(r=>{

              const checkbox=
                box.querySelector(
                  `.range-check[value="${CSS.escape(r.id)}"]`
                );

              return checkbox?.checked;
            });

          groupCheck.checked=
            allChecked;
        };
      });

  });


  let len=20;


  app
    .querySelectorAll('.len')
    .forEach(b=>{

      b.onclick=()=>{

        len=+b.dataset.n;

        app
          .querySelectorAll('.len')
          .forEach(x=>
            x.classList.add('secondary')
          );

        b.classList.remove('secondary');
      };
    });


  document
    .getElementById(
      'selectAllRanges'
    )
    .onclick=()=>{

      app
        .querySelectorAll(
          '.range-check'
        )
        .forEach(
          x=>x.checked=true
        );

      app
        .querySelectorAll(
          '.position-check'
        )
        .forEach(
          x=>x.checked=true
        );
    };


  document
    .getElementById(
      'clearAllRanges'
    )
    .onclick=()=>{

      app
        .querySelectorAll(
          '.range-check'
        )
        .forEach(
          x=>x.checked=false
        );

      app
        .querySelectorAll(
          '.position-check'
        )
        .forEach(
          x=>x.checked=false
        );
    };


  document
    .getElementById('start')
    .onclick=async()=>{

      const rs=
        await getRanges();

      const ids=
        [
          ...document
            .querySelectorAll(
              '.range-check:checked'
            )
        ]
        .map(
          x=>x.value
        );

      const sel=
        rs.filter(
          r=>ids.includes(r.id)
        );

      if(!sel.length){

        alert(
          'Sélectionne au moins une range.'
        );

        return;
      }

      const situations=
        buildSituations(sel);

      if(
        !situations.fold.length ||
        !situations.nonFold.length
      ){

        alert(
          'Pour respecter le ratio 30/70, les ranges sélectionnées doivent contenir au moins une situation Fold et une situation Non-Fold définies.'
        );

        return;
      }

      state.drill={

        ranges:sel,

        questions:
          makeQuestions(
            situations,
            len
          ),

        index:0,

        score:0,

        answers:[]
      };

      state.view='question';

      render();
    };
}


/* =========================================================
   LOGIQUE DU DRILL
========================================================= */

function isFoldOnly(r,h){

  const ids=
    r.mains[h]||[];

  if(!ids.length){
    return false;
  }

  return ids.every(id=>{

    const l=
      r.etiquettes.find(
        x=>x.id===id
      );

    return l &&
      l.nom
        .trim()
        .toLowerCase()==='fold';
  });
}

function buildSituations(rs){

  const fold=[];
  const nonFold=[];

  for(const r of rs){

    for(const h of allHands()){

      if(
        !(r.mains[h]||[]).length
      ){
        continue;
      }

      const labels=
        (r.mains[h]||[])
          .map(
            id=>
              r.etiquettes.find(
                l=>l.id===id
              )
          )
          .filter(Boolean);

      const s={
        rangeId:r.id,
        range:r,
        main:h,
        labels
      };

      if(
        isFoldOnly(r,h)
      ){

        fold.push(s);

      }else{

        nonFold.push(s);
      }
    }
  }

  return {
    fold,
    nonFold
  };
}

function sample(arr,n){

  const pool=[...arr];
  const out=[];

  for(let i=0;i<n;i++){

    if(!pool.length){
      pool.push(...arr);
    }

    const j=
      Math.floor(
        Math.random()*pool.length
      );

    out.push(
      pool.splice(j,1)[0]
    );
  }

  return out;
}

function makeQuestions(s,len){

  const foldCount=
    Math.round(len*.3);

  const nonFoldCount=
    len-foldCount;

  const q=[
    ...sample(
      s.fold,
      foldCount
    ),

    ...sample(
      s.nonFold,
      nonFoldCount
    )
  ];

  for(
    let i=q.length-1;
    i>0;
    i--
  ){

    const j=
      Math.floor(
        Math.random()*(i+1)
      );

    [
      q[i],
      q[j]
    ]=[
      q[j],
      q[i]
    ];
  }

  return q;
}


/* =========================================================
   QUESTIONS
========================================================= */

function renderDrill(app){

  const d=state.drill;

  if(!d){

    renderSetup(app);

    return;
  }

  if(state.view==='result'){

    renderResult(app);

    return;
  }

  const q=
    d.questions[d.index];

  const multi=
    d.ranges.length>1;

  const optionMap=
    new Map();

  for(const r of d.ranges){

    for(const l of r.etiquettes){

      optionMap.set(
        l.nom.trim(),
        l.nom.trim()
      );
    }
  }

  const opts=
    [...optionMap.values()];

  for(
    let i=opts.length-1;
    i>0;
    i--
  ){

    const j=
      Math.floor(
        Math.random()*(i+1)
      );

    [
      opts[i],
      opts[j]
    ]=[
      opts[j],
      opts[i]
    ];
  }


  app.innerHTML=`

    <main class="app">

      <div class="muted">
        Question
        ${d.index+1}
        /
        ${d.questions.length}
      </div>


      <div class="progress">

        <i
          style="
            width:${
              (d.index/d.questions.length)*100
            }%
          "
        ></i>

      </div>


      ${
        multi
        ?
        `
          <div class="context">
            ${esc(q.range.nom)}
          </div>
        `
        :
        ''
      }


      <div class="drill-hand">
        ${q.main}
      </div>


      <div class="answers">

        ${
          opts.map(o=>{

            const l=
              q.range.etiquettes.find(
                x=>
                  x.nom.trim()===o
              );

            return `

              <button
                class="btn answer"
                data-answer="${esc(o)}"
                style="
                  --answer-border:
                  ${esc(
                    l?.couleur ||
                    '#d7d7d1'
                  )}
                "
              >
                ${esc(o)}
              </button>

            `;
          }).join('')
        }

      </div>


      <div id="feedback"></div>

    </main>
  `;


  app
    .querySelectorAll('.answer')
    .forEach(b=>{

      b.onclick=()=>
        answer(
          q,
          b.dataset.answer
        );
    });
}

function answer(q,ans){

  const good=
    q.labels.some(
      l=>
        l.nom.trim()===ans
    );

  const d=state.drill;

  if(good){
    d.score++;
  }

  d.answers.push({

    rangeId:q.rangeId,

    main:q.main,

    answer:ans,

    correct:good,

    correctAnswers:
      q.labels.map(
        l=>l.nom
      )
  });


  document
    .querySelectorAll('.answer')
    .forEach(
      b=>b.disabled=true
    );


  const f=
    document.getElementById(
      'feedback'
    );


  f.innerHTML=`

    <div
      class="feedback ${
        good
          ? 'correct'
          : 'wrong'
      }"
    >

      <b>
        ${good?'✓ Correct':'✗ Incorrect'}
      </b>

      <br>

      Bonne réponse :
      <b>
        ${
          esc(
            q.labels
              .map(l=>l.nom)
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
        d.index+1<d.questions.length
          ? 'Suivant'
          : 'Voir le résultat'
      }
    </button>
  `;


  document
    .getElementById('next')
    .onclick=()=>{

      if(
        d.index+1<
        d.questions.length
      ){

        d.index++;

        state.view='question';

        render();

      }
      else{

        finishDrill();
      }
    };
}


/* =========================================================
   FIN DRILL
========================================================= */

async function finishDrill(){

  const d=state.drill;

  await addHistory({

    id:uid('drill'),

    date:
      new Date().toISOString(),

    score:d.score,

    total:d.questions.length,

    answers:d.answers,

    ranges:
      d.ranges.map(
        r=>r.id
      )
  });

  await trimHistory();

  state.view='result';

  render();
}


/* =========================================================
   RESULTAT
========================================================= */

function renderResult(app){

  const d=state.drill;

  const pct=
    Math.round(
      d.score/
      d.questions.length*
      100
    );

  app.innerHTML=`

    <main class="app">

      <div class="card result">

        <div class="muted">
          Drill terminé
        </div>

        <div class="score">
          ${pct}%
        </div>

        <div class="big">
          ${d.score}
          /
          ${d.questions.length}
        </div>

        <p>
          <b>
            ${pct} % de réussite
          </b>
        </p>

        <p>
          ${
            d.questions.length-d.score
          }
          erreur${
            d.questions.length-d.score>1
              ? 's'
              : ''
          }
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
    .getElementById('retry')
    .onclick=()=>{

      const s=
        buildSituations(
          d.ranges
        );

      d.questions=
        makeQuestions(
          s,
          d.questions.length
        );

      d.index=0;
      d.score=0;
      d.answers=[];

      state.view='question';

      render();
    };


  document
    .getElementById('home')
    .onclick=()=>
      nav('ranges');
}


/* =========================================================
   EVENEMENTS GLOBAUX
========================================================= */

document.addEventListener(
  'click',
  e=>{

    const n=
      e.target.closest(
        '[data-nav]'
      );

    if(n){
      nav(
        n.dataset.nav
      );
    }
  }
);


document
  .getElementById('app')
  .addEventListener(
    'pointerdown',
    e=>{

      if(
        e.target.closest(
          '.matrix-wrap'
        )
      ){
        e.preventDefault();
      }
    },
    {
      passive:false
    }
  );


/* =========================================================
   DEMARRAGE
========================================================= */

init().catch(e=>{

  document
    .getElementById('app')
    .innerHTML=`

      <main class="app">

        <div class="card">

          <b>
            Erreur de démarrage.
          </b>

          <p>
            Ton navigateur ne semble pas
            autoriser IndexedDB.
          </p>

        </div>

      </main>
    `;

  console.error(e);
});
