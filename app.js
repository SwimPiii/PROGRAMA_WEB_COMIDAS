(function () {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  const FULL_DAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
  const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const DEMO_STORAGE_KEY = "la-mesa-demo-v1";
  let state = emptyState();
  let demoMode = false;
  let weekStart = mondayOf(new Date());
  let recipeFilter = "todos";
  let saveChain = Promise.resolve();
  let toastTimer;

  function emptyState() { return { version: 1, recipes: [], plans: {}, shopping: { extras: [], checked: {} }, lastUpdated: null }; }
  function id() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  function mondayOf(date) { const d = new Date(date.getFullYear(), date.getMonth(), date.getDate()); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); d.setHours(0, 0, 0, 0); return d; }
  function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
  function plusDays(date, amount) { const result = new Date(date); result.setDate(result.getDate()+amount); return result; }
  function normalizeText(text) { return String(text || "").trim().toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char])); }
  function formatDate(date, options = { day: "numeric", month: "short" }) { return new Intl.DateTimeFormat("es-ES", options).format(date); }
  function showToast(message) { const toast = $("#toast"); toast.textContent = message; toast.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 2900); }
  function setStatus(text, mode = "") { $("#sync-label").textContent = text; $("#sync-status").className = `sync-status ${mode}`; }
  function connected() { return window.comidasDrive && window.comidasDrive.isSignedIn(); }
  function canEdit() { return connected() || demoMode; }
  function requireEditing() { if (canEdit()) return true; showToast("Pulsa «Probar sin Drive» o conecta Google Drive para empezar."); return false; }

  function normalizeState(raw) {
    const value = raw && typeof raw === "object" ? raw : {};
    return {
      version: 1,
      recipes: Array.isArray(value.recipes) ? value.recipes.filter(item => item && item.id && item.name).map(item => ({ id: String(item.id), name: String(item.name), type: item.type === "cena" ? "cena" : "comida", ingredients: Array.isArray(item.ingredients) ? item.ingredients.filter(ing => ing && ing.name).map(ing => ({ name: String(ing.name), grams: Math.max(0, Number(ing.grams) || 0) })) : [], tags: Array.isArray(item.tags) ? item.tags.map(normalizeText).filter(Boolean) : [] })) : [],
      plans: value.plans && typeof value.plans === "object" ? value.plans : {},
      shopping: { extras: Array.isArray(value.shopping && value.shopping.extras) ? value.shopping.extras.filter(item => item && item.id && item.name) : [], checked: value.shopping && value.shopping.checked && typeof value.shopping.checked === "object" ? value.shopping.checked : {} },
      lastUpdated: value.lastUpdated || null
    };
  }

  function persist() {
    if (!requireEditing()) return Promise.resolve(false);
    state.lastUpdated = new Date().toISOString();
    if (demoMode && !connected()) {
      try {
        localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
        setStatus("Modo prueba · guardado local", "connected");
        return Promise.resolve(true);
      } catch (error) {
        setStatus("No se pudo guardar localmente", "");
        showToast("El navegador no pudo guardar los datos de prueba.");
        return Promise.resolve(false);
      }
    }
    setStatus("Guardando…", "busy");
    const snapshot = JSON.stringify(state);
    saveChain = saveChain.catch(() => {}).then(() => window.comidasDrive.save(JSON.parse(snapshot))).then(() => {
      setStatus("Guardado en Drive", "connected");
      return true;
    }).catch(error => {
      console.error("No se pudo guardar en Drive", error);
      setStatus("Error al guardar", "");
      showToast(`No se pudo guardar: ${error.message || "comprueba la conexión"}`);
      return false;
    });
    return saveChain;
  }

  async function connect() {
    const buttons = [$("#connect-button"), $("#notice-connect")];
    buttons.forEach(button => { button.disabled = true; });
    setStatus("Conectando…", "busy");
    try {
      const data = await window.comidasDrive.signIn();
      state = normalizeState(data);
      demoMode = false;
      renderAll();
      $("#connection-notice").classList.remove("visible");
      $("#connect-button").textContent = "Drive conectado";
      $("#connect-button").title = "Pulsa para desconectar";
      setStatus("Guardado en Drive", "connected");
      showToast("¡Todo conectado! Ya podéis organizar la semana.");
      enableEditing(true);
    } catch (error) {
      console.error("Error de conexión con Drive", error);
      setStatus(demoMode ? "Modo prueba · guardado local" : "No conectado", demoMode ? "connected" : "");
      if (!demoMode) $("#connection-notice").classList.add("visible");
      showToast(error.message || "No se pudo conectar con Google Drive.");
    } finally { buttons.forEach(button => { button.disabled = false; }); }
  }

  async function disconnect() {
    if (!connected()) return connect();
    if (!confirm("¿Desconectar Google Drive? Los datos seguirán guardados en la nube.")) return;
    await window.comidasDrive.signOut();
    state = emptyState();
    demoMode = false;
    renderAll();
    enableEditing(false);
    $("#connect-button").textContent = "Conectar Drive";
    $("#connect-button").title = "";
    $("#connection-notice").classList.add("visible");
    setStatus("Conecta para empezar");
  }

  function startDemo() {
    if (connected()) return;
    try {
      const saved = localStorage.getItem(DEMO_STORAGE_KEY);
      state = saved ? normalizeState(JSON.parse(saved)) : emptyState();
    } catch (error) {
      console.warn("No se pudieron recuperar los datos de prueba locales", error);
      state = emptyState();
    }
    demoMode = true;
    $("#connection-notice").classList.remove("visible");
    $("#connect-button").textContent = "Conectar Drive";
    $("#connect-button").title = "Los datos de prueba están guardados solo en este navegador.";
    setStatus("Modo prueba · guardado local", "connected");
    renderAll();
    enableEditing(true);
    showToast("Modo de prueba activo. Los cambios se guardan solo en este navegador.");
  }

  function enableEditing(enabled) {
    ["#generate-button", "#recipe-form", "#shopping-form"].forEach(selector => {
      const element = $(selector);
      if (element.matches("form")) [...element.elements].forEach(control => { control.disabled = !enabled; });
      else element.disabled = !enabled;
    });
    $$(".meal-select").forEach(select => { select.disabled = !enabled; });
    $$(".check-box, .shopping-delete, .recipe-edit, .recipe-delete").forEach(button => { button.disabled = !enabled; });
    $("#add-ingredient").disabled = !enabled;
  }

  function switchPanel(name) {
    $$(".tab").forEach(tab => { const active = tab.dataset.panel === name; tab.classList.toggle("active", active); tab.setAttribute("aria-selected", String(active)); });
    $$(".panel").forEach(panel => { const active = panel.id === `panel-${name}`; panel.classList.toggle("active", active); panel.hidden = !active; });
  }

  function renderWeek() {
    const end = plusDays(weekStart, 6);
    const sameMonth = weekStart.getMonth() === end.getMonth();
    const label = sameMonth ? `${weekStart.getDate()}–${end.getDate()} de ${MONTHS[end.getMonth()]} ${end.getFullYear()}` : `${weekStart.getDate()} ${MONTHS[weekStart.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;
    $("#week-label").textContent = label;
    const today = new Date();
    $("#today-label").textContent = `Hoy · ${formatDate(today, { weekday: "long", day: "numeric", month: "long" })}`;
    const grid = $("#week-grid");
    grid.innerHTML = "";
    for (let index=0; index<7; index++) {
      const date = plusDays(weekStart, index), key = dateKey(date), plan = state.plans[key] || {};
      const isToday = key === dateKey(today), weekend = index > 4;
      const card = document.createElement("article");
      card.className = `day-card${isToday ? " today" : ""}${weekend ? " weekend" : ""}`;
      card.innerHTML = `<header class="day-header"><div><span class="day-name">${WEEKDAYS[index]}</span><span class="day-number">${date.getDate()} ${MONTHS[date.getMonth()].slice(0,3)}</span></div>${isToday ? '<span class="today-tag">HOY</span>' : ""}</header>${mealSlot(key,"comida",plan.comida,weekend)}${mealSlot(key,"cena",plan.cena,weekend)}`;
      grid.append(card);
    }
    $$(".meal-select").forEach(select => {
      select.disabled = !canEdit();
      select.addEventListener("change", () => {
        if (!requireEditing()) { renderWeek(); return; }
        const { date, meal } = select.dataset;
        const recipeId = select.value || null;
        if (recipeId && mealConflict(date, meal, recipeId)) { showToast("Ese plato comparte una etiqueta de exclusión con el otro plato del día."); renderWeek(); return; }
        state.plans[date] = { ...(state.plans[date] || {}), [meal]: recipeId };
        if (!state.plans[date].comida && !state.plans[date].cena) delete state.plans[date];
        renderWeek(); renderShopping(); persist();
      });
    });
    $("#cart-week-title").textContent = `Compra · semana del ${formatDate(weekStart, { day:"numeric", month:"long" })}`;
    $("#cart-week-caption").textContent = `${formatDate(weekStart)} – ${formatDate(end, { day:"numeric", month:"short", year:"numeric" })} · ingredientes de lunes a domingo.`;
  }

  function mealSlot(date, type, selectedId, weekend) {
    const options = state.recipes.filter(recipe => recipe.type === type).slice().sort((a,b) => a.name.localeCompare(b.name,"es"));
    const chosen = options.some(recipe => recipe.id === selectedId) ? selectedId : "";
    return `<div class="meal-slot"><label class="meal-label" for="select-${date}-${type}"><span>${type === "comida" ? "☀" : "☾"}</span> ${type}</label><select class="meal-select${chosen ? "" : " empty-select"}" id="select-${date}-${type}" data-date="${date}" data-meal="${type}" aria-label="${type} del ${date}"><option value="">${options.length ? "＋ Elegir plato" : "＋ Añadir platos"}</option>${options.map(recipe => `<option value="${escapeHtml(recipe.id)}" ${recipe.id===chosen?"selected":""}>${escapeHtml(recipe.name)}</option>`).join("")}</select></div>`;
  }

  function recipeById(recipeId) { return state.recipes.find(recipe => recipe.id === recipeId); }
  function mealConflict(date, meal, candidateId) {
    const candidate = recipeById(candidateId), otherId = (state.plans[date] || {})[meal === "comida" ? "cena" : "comida"], other = recipeById(otherId);
    if (!candidate || !other) return false;
    return candidate.tags.some(tag => other.tags.includes(tag));
  }

  function renderRecipes() {
    const list = $("#recipe-list");
    const recipes = state.recipes.filter(recipe => recipeFilter === "todos" || recipe.type === recipeFilter).slice().sort((a,b) => a.name.localeCompare(b.name,"es"));
    $("#recipe-count").textContent = state.recipes.length;
    $("#recipe-summary").textContent = `${state.recipes.length} ${state.recipes.length === 1 ? "plato guardado" : "platos guardados"}`;
    list.innerHTML = "";
    if (!recipes.length) { list.innerHTML = `<div class="empty-state"><strong>${state.recipes.length ? "No hay platos en este filtro" : "Aún no hay platos"}</strong>${state.recipes.length ? "Prueba otra categoría." : "Añade el primero con el formulario."}</div>`; return; }
    recipes.forEach(recipe => {
      const card = document.createElement("article"); card.className = "recipe-card";
      const summary = recipe.ingredients.map(ingredient => `${escapeHtml(ingredient.name)}${ingredient.grams ? ` · ${formatQuantity(ingredient.grams)} g` : ""}`).join(", ") || "Sin ingredientes";
      card.innerHTML = `<div class="recipe-symbol ${recipe.type === "cena" ? "dinner" : ""}">${recipe.type === "cena" ? "☾" : "☀"}</div><div class="recipe-info"><div class="recipe-title-row"><span class="recipe-title">${escapeHtml(recipe.name)}</span><span class="type-badge ${recipe.type === "cena" ? "dinner" : ""}">${recipe.type}</span></div><p class="ingredient-summary">${summary}</p>${recipe.tags.length ? `<div class="tag-list">${recipe.tags.map(tag=>`<span class="tag-chip">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}</div><div class="card-actions"><button class="mini-button recipe-edit" type="button" data-id="${escapeHtml(recipe.id)}" aria-label="Editar ${escapeHtml(recipe.name)}">Editar</button><button class="mini-button recipe-delete" type="button" data-id="${escapeHtml(recipe.id)}" aria-label="Eliminar ${escapeHtml(recipe.name)}">×</button></div>`;
      list.append(card);
    });
    $$(".recipe-edit").forEach(button => button.addEventListener("click", () => editRecipe(button.dataset.id)));
    $$(".recipe-delete").forEach(button => button.addEventListener("click", () => deleteRecipe(button.dataset.id)));
    enableEditing(canEdit());
  }

  function formatQuantity(number) { return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(number); }
  function addIngredientRow(ingredient = {}) {
    const row = document.createElement("div"); row.className = "ingredient-row";
    row.innerHTML = `<input class="input ingredient-name" type="text" maxlength="80" placeholder="Nombre (ej. arroz)" value="${escapeHtml(ingredient.name || "")}" aria-label="Nombre del ingrediente"><input class="input ingredient-grams" type="number" min="0" step="any" placeholder="Gramos" value="${ingredient.grams ? escapeHtml(ingredient.grams) : ""}" aria-label="Cantidad en gramos"><button class="remove-ingredient" type="button" aria-label="Eliminar ingrediente">×</button>`;
    row.querySelector(".remove-ingredient").addEventListener("click", () => { if ($$(".ingredient-row").length > 1) row.remove(); else { row.querySelector(".ingredient-name").value = ""; row.querySelector(".ingredient-grams").value = ""; } });
    $("#ingredient-rows").append(row);
  }

  function resetRecipeForm() {
    $("#recipe-form").reset(); $("#recipe-id").value = ""; $("#ingredient-rows").innerHTML = ""; addIngredientRow();
    $("#form-heading").textContent = "Añadir un plato"; $("#save-recipe").textContent = "Guardar plato"; $("#cancel-edit").hidden = true;
  }
  function editRecipe(recipeId) {
    if (!requireEditing()) return;
    const recipe = recipeById(recipeId); if (!recipe) return;
    $("#recipe-id").value = recipe.id; $("#recipe-name").value = recipe.name; $("#exclusion-tags").value = recipe.tags.join(", ");
    $(`input[name="meal-type"][value="${recipe.type}"]`).checked = true;
    $("#ingredient-rows").innerHTML = ""; (recipe.ingredients.length ? recipe.ingredients : [{}]).forEach(addIngredientRow);
    $("#form-heading").textContent = "Editar plato"; $("#save-recipe").textContent = "Guardar cambios"; $("#cancel-edit").hidden = false;
    $("#recipe-form").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function deleteRecipe(recipeId) {
    if (!requireEditing()) return;
    const recipe = recipeById(recipeId); if (!recipe || !confirm(`¿Eliminar «${recipe.name}»? También se quitará de los días planificados.`)) return;
    state.recipes = state.recipes.filter(item => item.id !== recipeId);
    Object.keys(state.plans).forEach(date => { ["comida","cena"].forEach(type => { if (state.plans[date][type] === recipeId) state.plans[date][type] = null; }); if (!state.plans[date].comida && !state.plans[date].cena) delete state.plans[date]; });
    renderAll(); await persist(); showToast("Plato eliminado.");
  }

  async function onRecipeSubmit(event) {
    event.preventDefault(); if (!requireEditing()) return;
    const name = $("#recipe-name").value.trim();
    const ingredients = $$(".ingredient-row").map(row => ({ name: row.querySelector(".ingredient-name").value.trim(), grams: Number(row.querySelector(".ingredient-grams").value) || 0 })).filter(item => item.name);
    if (!name) { $("#recipe-name").focus(); return; }
    if (!ingredients.length) { showToast("Añade al menos un ingrediente."); $(".ingredient-name").focus(); return; }
    const duplicate = state.recipes.find(recipe => normalizeText(recipe.name) === normalizeText(name) && recipe.id !== $("#recipe-id").value);
    if (duplicate) { showToast("Ya existe un plato con ese nombre."); return; }
    const recipe = { id: $("#recipe-id").value || id(), name, type: $("input[name='meal-type']:checked").value, ingredients, tags: $("#exclusion-tags").value.split(",").map(normalizeText).filter(Boolean) };
    const index = state.recipes.findIndex(item => item.id === recipe.id);
    if (index >= 0) {
      state.recipes[index] = recipe;
      Object.keys(state.plans).forEach(date => {
        ["comida", "cena"].forEach(type => {
          if (state.plans[date][type] === recipe.id && type !== recipe.type) state.plans[date][type] = null;
        });
        if (!state.plans[date].comida && !state.plans[date].cena) delete state.plans[date];
      });
    } else state.recipes.push(recipe);
    resetRecipeForm(); renderAll(); await persist(); showToast(index >= 0 ? "Cambios guardados." : "Plato añadido al recetario.");
  }

  function generateWeek() {
    if (!requireEditing()) return;
    const dates = Array.from({length:5}, (_,index) => dateKey(plusDays(weekStart,index)));
    const slots = dates.flatMap(date => [{date,type:"comida"},{date,type:"cena"}]);
    const candidates = { comida: state.recipes.filter(recipe=>recipe.type==="comida"), cena: state.recipes.filter(recipe=>recipe.type==="cena") };
    if (!candidates.comida.length || !candidates.cena.length) { showToast("Añade al menos un plato de comida y uno de cena."); return; }
    const chosen = {}, usedRecipes = new Set();
    const solve = index => {
      if (index === slots.length) return true;
      const slot = slots[index];
      const options = candidates[slot.type].filter(recipe => !usedRecipes.has(recipe.id) && !mealConflictWithChosen(slot.date, recipe));
      shuffle(options);
      for (const recipe of options) {
        chosen[`${slot.date}|${slot.type}`] = recipe.id; usedRecipes.add(recipe.id);
        if (solve(index+1)) return true;
        usedRecipes.delete(recipe.id); delete chosen[`${slot.date}|${slot.type}`];
      }
      return false;
    };
    function mealConflictWithChosen(date, recipe) {
      const otherType = recipe.type === "comida" ? "cena" : "comida";
      const otherId = chosen[`${date}|${otherType}`], other = recipeById(otherId);
      return !!(other && recipe.tags.some(tag => other.tags.includes(tag)));
    }
    if (!solve(0)) { showToast("No hay suficientes platos compatibles para completar de lunes a viernes. Añade más recetas o ajusta sus etiquetas."); return; }
    dates.forEach(date => { state.plans[date] = { comida: chosen[`${date}|comida`], cena: chosen[`${date}|cena`] }; });
    renderAll(); persist(); showToast("¡Semana sorteada! Puedes cambiar cualquier plato.");
  }
  function shuffle(array) { for(let i=array.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[array[i],array[j]]=[array[j],array[i]];} }

  function shoppingItems() {
    const aggregate = new Map();
    for(let index=0; index<7; index++) {
      const plan = state.plans[dateKey(plusDays(weekStart,index))] || {};
      [plan.comida,plan.cena].forEach(recipeId => { const recipe = recipeById(recipeId); if(!recipe) return; recipe.ingredients.forEach(ingredient => {
        const unit="g", key=`${normalizeText(ingredient.name)}|${unit}`;
        if(!aggregate.has(key)) aggregate.set(key,{ key,name:ingredient.name.trim(),quantity:0,unit,source:"recipe",extras:[] });
        aggregate.get(key).quantity += Number(ingredient.grams)||0;
      }); });
    }
    const currentWeek = dateKey(weekStart);
    state.shopping.extras.filter(item=>item.weekStart===currentWeek).forEach(extra=>{
      const unit=String(extra.unit||"unidad").trim()||"unidad", key=`${normalizeText(extra.name)}|${normalizeText(unit)}`;
      if(!aggregate.has(key)) aggregate.set(key,{key,name:String(extra.name).trim(),quantity:0,unit,source:"extra",extras:[]});
      const item=aggregate.get(key); item.quantity += Number(extra.quantity)||0; item.extras.push(extra);
    });
    return [...aggregate.values()].sort((a,b)=>a.name.localeCompare(b.name,"es"));
  }

  function renderShopping() {
    const list=$("#shopping-list"), items=shoppingItems(), currentWeek=dateKey(weekStart);
    list.innerHTML="";
    const groups = [{title:"Ingredientes del menú",items:items.filter(item=>item.source==="recipe"||item.unit==="g")},{title:"Otros productos",items:items.filter(item=>item.source==="extra"&&item.unit!=="g")}];
    groups.forEach(group=>{
      if(!group.items.length) return;
      const heading=document.createElement("div"); heading.className="shopping-group"; heading.textContent=group.title; list.append(heading);
      group.items.forEach(item=>{
        const checked=!!state.shopping.checked[`${currentWeek}|${item.key}`];
        const quantityText=item.quantity ? `${formatQuantity(item.quantity)} ${item.unit}` : "";
        const row=document.createElement("div"); row.className=`shopping-item${checked?" checked":""}`;
        row.innerHTML=`<input class="check-box" type="checkbox" ${checked?"checked":""} aria-label="Marcar ${escapeHtml(item.name)} como comprado"><span class="shopping-name">${escapeHtml(item.name)}</span>${quantityText?`<span class="shopping-qty">${escapeHtml(quantityText)}</span>`:""}${item.source==="recipe"?'<span class="shopping-source">menú</span>':`<button class="shopping-delete" type="button" aria-label="Quitar ${escapeHtml(item.name)} de la cesta">×</button>`}`;
        const checkbox=row.querySelector(".check-box"); checkbox.disabled=!canEdit(); checkbox.addEventListener("change",()=>{state.shopping.checked[`${currentWeek}|${item.key}`]=checkbox.checked;renderShopping();persist();});
        const remove=row.querySelector(".shopping-delete"); if(remove){remove.disabled=!canEdit();remove.addEventListener("click",()=>{state.shopping.extras=state.shopping.extras.filter(extra=>!item.extras.some(matched=>matched.id===extra.id));renderShopping();persist();});}
        list.append(row);
      });
    });
    const checkedCount=items.filter(item=>state.shopping.checked[`${currentWeek}|${item.key}`]).length;
    const percent=items.length?Math.round(checkedCount/items.length*100):0;
    $("#cart-count").textContent=items.length;
    $("#cart-progress-label").textContent=`${checkedCount} de ${items.length} ${items.length===1?"producto comprado":"productos comprados"}`;
    $("#cart-progress-percent").textContent=`${percent}%`;
    $("#cart-progress-bar").style.width=`${percent}%`;
    $("#cart-empty-note").hidden=items.length>0;
  }

  async function addShoppingItem(event) {
    event.preventDefault(); if(!requireEditing())return;
    const name=$("#shopping-name").value.trim(), unit=$("#shopping-unit").value.trim()||"unidad", quantity=Number($("#shopping-quantity").value)||0;
    if(!name)return;
    const start=dateKey(weekStart);
    const duplicate=state.shopping.extras.find(item=>item.weekStart===start&&normalizeText(item.name)===normalizeText(name)&&normalizeText(item.unit||"unidad")==normalizeText(unit));
    if(duplicate) duplicate.quantity=(Number(duplicate.quantity)||0)+quantity;
    else state.shopping.extras.push({id:id(),weekStart:start,name,quantity,unit});
    $("#shopping-form").reset(); $("#shopping-unit").value="unidad"; renderShopping(); await persist(); showToast("Añadido a la cesta.");
  }

  function renderAll() { renderWeek(); renderRecipes(); renderShopping(); enableEditing(canEdit()); }
  function init() {
    $$(".tab").forEach(tab=>tab.addEventListener("click",()=>switchPanel(tab.dataset.panel)));
    $("#connect-button").addEventListener("click",()=>connected()?disconnect():connect()); $("#notice-connect").addEventListener("click",connect); $("#demo-button").addEventListener("click",startDemo);
    $("#previous-week").addEventListener("click",()=>{weekStart=plusDays(weekStart,-7);renderAll();});
    $("#next-week").addEventListener("click",()=>{weekStart=plusDays(weekStart,7);renderAll();});
    $("#current-week").addEventListener("click",()=>{weekStart=mondayOf(new Date());renderAll();});
    $("#generate-button").addEventListener("click",generateWeek);
    $("#add-ingredient").addEventListener("click",()=>addIngredientRow());
    $("#recipe-form").addEventListener("submit",onRecipeSubmit); $("#cancel-edit").addEventListener("click",resetRecipeForm);
    $(".filter-pills").addEventListener("click",event=>{const button=event.target.closest("[data-filter]");if(!button)return;recipeFilter=button.dataset.filter;$$('.filter-pill').forEach(pill=>pill.classList.toggle("active",pill===button));renderRecipes();});
    $("#shopping-form").addEventListener("submit",addShoppingItem);
    $("#cart-go-week").addEventListener("click",()=>switchPanel("plan"));
    addIngredientRow(); $("#connection-notice").classList.add("visible");
    try { if (localStorage.getItem(DEMO_STORAGE_KEY)) $("#demo-button").textContent = "Continuar prueba local"; } catch { /* almacenamiento no disponible */ }
    renderAll(); enableEditing(false);
  }
  document.addEventListener("DOMContentLoaded",init);
})();
