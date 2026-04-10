const state = {
  html: '',
  analysis: null,
  selected: {
    kind: null,
    id: null
  }
};

const elements = {
  extractJson: document.getElementById('extract-json'),
  htmlFile: document.getElementById('html-file'),
  analysisJson: document.getElementById('analysis-json'),
  previewContainer: document.getElementById('preview-container'),
  previewStatus: document.getElementById('preview-status'),
  fieldList: document.getElementById('field-list'),
  conditionalList: document.getElementById('conditional-list'),
  repeatableList: document.getElementById('repeatable-list'),
  fieldCount: document.getElementById('field-count'),
  conditionalCount: document.getElementById('conditional-count'),
  repeatableCount: document.getElementById('repeatable-count'),
  itemSelected: document.getElementById('item-selected'),
  downloadAnalysis: document.getElementById('download-analysis'),
  fieldId: document.getElementById('field-id'),
  fieldPattern: document.getElementById('field-pattern'),
  fieldType: document.getElementById('field-type'),
  fieldCategory: document.getElementById('field-category'),
  fieldPath: document.getElementById('field-path'),
  fieldRequired: document.getElementById('field-required'),
  conditionalId: document.getElementById('conditional-id'),
  conditionalText: document.getElementById('conditional-text'),
  conditionalCondition: document.getElementById('conditional-condition'),
  conditionalConfidence: document.getElementById('conditional-confidence'),
  repeatableId: document.getElementById('repeatable-id'),
  repeatableText: document.getElementById('repeatable-text'),
  repeatableEntity: document.getElementById('repeatable-entity'),
  repeatableMin: document.getElementById('repeatable-min'),
  repeatableMax: document.getElementById('repeatable-max'),
  applyChanges: document.getElementById('apply-changes'),
  editorSections: document.querySelectorAll('.editor-section')
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function updateStatus() {
  if (!state.html) {
    elements.previewStatus.textContent = 'Load extraction JSON or HTML file.';
    return;
  }
  if (!state.analysis) {
    elements.previewStatus.textContent = 'Load analysis JSON.';
    return;
  }
  elements.previewStatus.textContent = 'Preview ready.';
}

function renderPreview() {
  if (!state.html || !state.analysis) {
    updateStatus();
    return;
  }

  const fields = state.analysis.campos || [];
  const conditionals = state.analysis.condicionais || [];
  const repeatables = state.analysis.repetiveis || [];

  let html = state.html;
  const tokens = [];

  function replaceWithToken(kind, id, display) {
    if (!display) return;
    const token = `@@${kind.toUpperCase()}_${tokens.length}@@`;
    const regex = new RegExp(escapeRegExp(display), 'g');
    html = html.replace(regex, token);
    tokens.push({ token, kind, id, display });
  }

  fields.forEach((field) => replaceWithToken('campo', field.id, field.padrao_encontrado));
  conditionals.forEach((cond) => replaceWithToken('condicional', cond.id, (cond.texto || '').trim()));
  repeatables.forEach((rep) => replaceWithToken('repetivel', rep.id, (rep.texto_exemplo || '').trim()));

  tokens.forEach(({ token, kind, id, display }) => {
    const className = kind === 'campo' ? 'field' : kind === 'condicional' ? 'conditional' : 'repeatable';
    const mark = `<mark class="${className}" data-kind="${kind}" data-id="${id}">${escapeHtml(display)}</mark>`;
    html = html.replaceAll(token, mark);
  });

  elements.previewContainer.innerHTML = html;
  elements.previewContainer.querySelectorAll('mark[data-kind]').forEach((mark) => {
    mark.addEventListener('click', () => {
      const kind = mark.getAttribute('data-kind');
      const id = mark.getAttribute('data-id');
      selectItem(kind, id);
    });
  });

  updateLists();
  updateStatus();
  highlightSelected();
}

function updateLists() {
  updateFieldList();
  updateConditionalList();
  updateRepeatableList();
}

function updateFieldList() {
  const fields = state.analysis?.campos || [];
  elements.fieldList.innerHTML = '';
  elements.fieldCount.textContent = fields.length;

  fields.forEach((field) => {
    const li = document.createElement('li');
    li.dataset.fieldId = field.id;
    li.innerHTML = `<strong>${field.id}</strong><br/><span>${field.sugestao_formulario || ''}</span>`;
    if (state.selected.kind === 'campo' && state.selected.id === field.id) {
      li.classList.add('selected');
    }
    li.addEventListener('click', () => selectItem('campo', field.id));
    elements.fieldList.appendChild(li);
  });
}

function updateConditionalList() {
  const conditionals = state.analysis?.condicionais || [];
  elements.conditionalList.innerHTML = '';
  elements.conditionalCount.textContent = conditionals.length;

  conditionals.forEach((cond) => {
    const li = document.createElement('li');
    li.dataset.conditionalId = cond.id;
    li.innerHTML = `<strong>${cond.id}</strong><br/><span>${(cond.texto || '').slice(0, 60)}</span>`;
    if (state.selected.kind === 'condicional' && state.selected.id === cond.id) {
      li.classList.add('selected');
    }
    li.addEventListener('click', () => selectItem('condicional', cond.id));
    elements.conditionalList.appendChild(li);
  });
}

function updateRepeatableList() {
  const repeatables = state.analysis?.repetiveis || [];
  elements.repeatableList.innerHTML = '';
  elements.repeatableCount.textContent = repeatables.length;

  repeatables.forEach((rep) => {
    const li = document.createElement('li');
    li.dataset.repeatableId = rep.id;
    li.innerHTML = `<strong>${rep.id}</strong><br/><span>${rep.entidade || ''}</span>`;
    if (state.selected.kind === 'repetivel' && state.selected.id === rep.id) {
      li.classList.add('selected');
    }
    li.addEventListener('click', () => selectItem('repetivel', rep.id));
    elements.repeatableList.appendChild(li);
  });
}

function selectItem(kind, id) {
  if (!state.analysis) return;
  state.selected = { kind, id };
  const label = kind && id ? `${kind}: ${id}` : 'None';
  elements.itemSelected.textContent = label;
  elements.applyChanges.disabled = false;

  elements.editorSections.forEach((section) => {
    section.classList.toggle('active', section.dataset.kind === kind);
  });

  if (kind === 'campo') {
    const field = state.analysis.campos.find((item) => item.id === id);
    if (!field) return;
    elements.fieldId.value = field.id || '';
    elements.fieldPattern.value = field.padrao_encontrado || '';
    elements.fieldType.value = field.tipo || 'texto';
    elements.fieldCategory.value = field.categoria || '';
    elements.fieldPath.value = field.sugestao_formulario || '';
    elements.fieldRequired.checked = Boolean(field.obrigatorio);
  }

  if (kind === 'condicional') {
    const cond = state.analysis.condicionais.find((item) => item.id === id);
    if (!cond) return;
    elements.conditionalId.value = cond.id || '';
    elements.conditionalText.value = cond.texto || '';
    elements.conditionalCondition.value = cond.condicao_sugerida || '';
    elements.conditionalConfidence.value = cond.confianca ?? '';
  }

  if (kind === 'repetivel') {
    const rep = state.analysis.repetiveis.find((item) => item.id === id);
    if (!rep) return;
    elements.repeatableId.value = rep.id || '';
    elements.repeatableText.value = rep.texto_exemplo || '';
    elements.repeatableEntity.value = rep.entidade || '';
    elements.repeatableMin.value = rep.min ?? '';
    elements.repeatableMax.value = rep.max ?? '';
  }

  updateLists();
  highlightSelected();
}

function highlightSelected() {
  const { kind, id } = state.selected;
  elements.previewContainer.querySelectorAll('mark[data-kind]').forEach((mark) => {
    const matches = mark.getAttribute('data-kind') === kind && mark.getAttribute('data-id') === id;
    mark.classList.toggle('selected', matches);
  });
}

function applyChanges() {
  if (!state.analysis || !state.selected.kind || !state.selected.id) return;
  const kind = state.selected.kind;
  const id = state.selected.id;

  if (kind === 'campo') {
    const field = state.analysis.campos.find((item) => item.id === id);
    if (!field) return;
    field.tipo = elements.fieldType.value;
    field.categoria = elements.fieldCategory.value.trim() || undefined;
    field.sugestao_formulario = elements.fieldPath.value.trim();
    field.obrigatorio = elements.fieldRequired.checked;
  }

  if (kind === 'condicional') {
    const cond = state.analysis.condicionais.find((item) => item.id === id);
    if (!cond) return;
    cond.condicao_sugerida = elements.conditionalCondition.value.trim();
    const confidence = Number(elements.conditionalConfidence.value);
    cond.confianca = Number.isFinite(confidence) ? confidence : cond.confianca;
  }

  if (kind === 'repetivel') {
    const rep = state.analysis.repetiveis.find((item) => item.id === id);
    if (!rep) return;
    rep.entidade = elements.repeatableEntity.value.trim();
    const minValue = elements.repeatableMin.value.trim();
    const maxValue = elements.repeatableMax.value.trim();
    rep.min = minValue === '' ? undefined : Number(minValue);
    rep.max = maxValue === '' ? null : Number(maxValue);
  }

  updateLists();
  elements.downloadAnalysis.disabled = false;
}

function downloadAnalysis() {
  if (!state.analysis) return;
  const blob = new Blob([JSON.stringify(state.analysis, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'analysis_updated.json';
  a.click();
  URL.revokeObjectURL(url);
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

elements.extractJson.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await readFile(file);
  const data = JSON.parse(text);
  state.html = data.html || '';
  renderPreview();
});

elements.htmlFile.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await readFile(file);
  state.html = text || '';
  renderPreview();
});

elements.analysisJson.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await readFile(file);
  state.analysis = JSON.parse(text);
  elements.downloadAnalysis.disabled = false;
  renderPreview();
});

elements.applyChanges.addEventListener('click', () => {
  applyChanges();
});

elements.downloadAnalysis.addEventListener('click', () => {
  downloadAnalysis();
});

updateStatus();
