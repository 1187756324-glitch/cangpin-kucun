const DB_NAME = "collection-stock";
const DB_VERSION = 1;
const PRODUCTS = "products";
const MOVEMENTS = "movements";

const state = {
  products: [],
  movements: [],
  category: "全部",
  movementType: "in",
  pendingImage: null,
  editingProductId: null,
  deletingProductId: null,
  dialogImageUrl: null,
  objectUrls: [],
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PRODUCTS)) {
        db.createObjectStore(PRODUCTS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(MOVEMENTS)) {
        const store = db.createObjectStore(MOVEMENTS, { keyPath: "id" });
        store.createIndex("productId", "productId", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAll(storeName) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function put(storeName, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    transaction.oncomplete = () => resolve(value);
    transaction.onerror = () => reject(transaction.error);
  });
}

async function replaceAll(products, movements) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([PRODUCTS, MOVEMENTS], "readwrite");
    const productStore = transaction.objectStore(PRODUCTS);
    const movementStore = transaction.objectStore(MOVEMENTS);
    productStore.clear();
    movementStore.clear();
    products.forEach((item) => productStore.put(item));
    movements.forEach((item) => movementStore.put(item));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${crypto.getRandomValues(new Uint32Array(1))[0].toString(16)}`;
}

function stockFor(productId) {
  return state.movements
    .filter((movement) => movement.productId === productId)
    .reduce((total, movement) => total + (movement.type === "in" ? movement.quantity : -movement.quantity), 0);
}

function totalStock() {
  return state.products.reduce((total, product) => total + Math.max(0, stockFor(product.id)), 0);
}

function formatTime(value) {
  const date = new Date(value);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const datePart = isToday ? "今天" : `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${datePart} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clearObjectUrls() {
  state.objectUrls.forEach((url) => URL.revokeObjectURL(url));
  state.objectUrls = [];
}

function imageUrl(blob) {
  if (!blob) return "";
  const url = URL.createObjectURL(blob);
  state.objectUrls.push(url);
  return url;
}

function renderInventory() {
  clearObjectUrls();
  $("#totalStock").textContent = totalStock();
  const visible = state.category === "全部"
    ? state.products
    : state.products.filter((product) => product.category === state.category);

  $("#inventoryEmpty").hidden = state.products.length !== 0;
  $("#productGrid").hidden = state.products.length === 0;

  $("#productGrid").innerHTML = visible.map((product) => {
    const stock = stockFor(product.id);
    const src = imageUrl(product.image);
    return `
      <article class="product-card">
        <div class="product-image">
          ${src ? `<img src="${src}" alt="${escapeHtml(product.name)}" />` : `<span class="placeholder">${escapeHtml(product.category)}</span>`}
        </div>
        <div class="product-meta">
          <div class="product-meta-top">
            <span class="product-category">${escapeHtml(product.category)}</span>
            <button type="button" class="manage-button" data-edit-product="${product.id}" aria-label="管理${escapeHtml(product.name)}">管理</button>
          </div>
          <div class="product-name">${escapeHtml(product.name)}</div>
          <div class="product-count"><span>库存</span><span><strong>${stock}</strong> ${escapeHtml(product.unit)}</span></div>
        </div>
      </article>`;
  }).join("");
}

function renderProductOptions() {
  const select = $("#recordProduct");
  const current = select.value;
  select.innerHTML = `<option value="">请选择商品</option>${state.products.map((product) =>
    `<option value="${product.id}">${escapeHtml(product.name)}（${stockFor(product.id)} ${escapeHtml(product.unit)}）</option>`
  ).join("")}`;
  if (state.products.some((product) => product.id === current)) select.value = current;
  updateStockHint();
}

function renderManageProducts() {
  const list = $("#manageProductList");
  $("#manageEmpty").hidden = state.products.length !== 0;
  list.hidden = state.products.length === 0;
  list.innerHTML = state.products.map((product) => {
    const src = imageUrl(product.image);
    const stock = stockFor(product.id);
    return `
      <article class="manage-item">
        <div class="manage-thumb">
          ${src ? `<img src="${src}" alt="${escapeHtml(product.name)}" />` : `<span>${escapeHtml(product.category)}</span>`}
        </div>
        <div class="manage-info">
          <strong>${escapeHtml(product.name)}</strong>
          <small>${escapeHtml(product.category)} · 库存 ${stock} ${escapeHtml(product.unit)}</small>
        </div>
        <div class="manage-actions">
          <button type="button" class="edit-button" data-edit-product="${product.id}">编辑</button>
          <button type="button" class="delete-button" data-delete-product="${product.id}">删除</button>
        </div>
      </article>`;
  }).join("");
}

function renderHistory() {
  const productMap = new Map(state.products.map((product) => [product.id, product]));
  const movements = [...state.movements].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  $("#historyEmpty").hidden = movements.length !== 0;
  $("#historyList").hidden = movements.length === 0;
  $("#historyList").innerHTML = movements.map((movement) => {
    const product = productMap.get(movement.productId);
    if (!product) return "";
    const label = movement.type === "in" ? "存入" : "存出";
    const sign = movement.type === "in" ? "+" : "−";
    return `
      <article class="history-item">
        <div class="history-badge ${movement.type}">${label}</div>
        <div class="history-main">
          <strong>${escapeHtml(product.name)}</strong>
          <small>${escapeHtml(movement.note || label)} · ${formatTime(movement.createdAt)}</small>
        </div>
        <span class="history-qty ${movement.type}">${sign}${movement.quantity} ${escapeHtml(product.unit)}</span>
      </article>`;
  }).join("");
}

function renderAll() {
  renderInventory();
  renderManageProducts();
  renderProductOptions();
  renderHistory();
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function navigate(target) {
  const titles = { inventory: "库存", manage: "商品管理", record: "记一笔", history: "流水" };
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === `${target}View`));
  $$("[data-nav]").forEach((button) => button.classList.toggle("active", button.dataset.nav === target));
  $("#pageTitle").textContent = titles[target];
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setMovementType(type) {
  state.movementType = type;
  $$("[data-movement]").forEach((button) => button.classList.toggle("active", button.dataset.movement === type));
  $("#recordSubmit").textContent = type === "in" ? "确认存入" : "确认存出";
  updateStockHint();
}

function updateStockHint() {
  const product = state.products.find((item) => item.id === $("#recordProduct")?.value);
  $("#stockHint").textContent = product
    ? `当前库存：${stockFor(product.id)} ${product.unit}`
    : "选择商品后显示当前库存";
}

async function compressImage(file) {
  if (!file) return null;
  const bitmap = await createImageBitmap(file);
  const maxSide = 1200;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.78));
}

async function addProduct({ name, category, unit, initialQuantity = 0, image = null }) {
  const product = {
    id: uid("product"),
    name: name.trim(),
    category,
    unit,
    image,
    createdAt: new Date().toISOString(),
  };
  if (!product.name) throw new Error("请输入商品名称");
  await put(PRODUCTS, product);
  state.products.push(product);

  const quantity = Number(initialQuantity);
  if (quantity > 0) {
    const movement = {
      id: uid("movement"),
      productId: product.id,
      type: "in",
      quantity,
      note: "初始库存",
      createdAt: new Date().toISOString(),
    };
    await put(MOVEMENTS, movement);
    state.movements.push(movement);
  }
  renderAll();
  return product;
}

async function updateProduct({ id, name, category, unit, image }) {
  const index = state.products.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("没有找到这个商品");
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("请输入商品名称");
  const product = {
    ...state.products[index],
    name: trimmedName,
    category,
    unit,
    image,
    updatedAt: new Date().toISOString(),
  };
  await put(PRODUCTS, product);
  state.products[index] = product;
  renderAll();
  return product;
}

async function deleteProduct(productId) {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction([PRODUCTS, MOVEMENTS], "readwrite");
    transaction.objectStore(PRODUCTS).delete(productId);
    const cursorRequest = transaction.objectStore(MOVEMENTS).index("productId").openCursor(IDBKeyRange.only(productId));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  state.products = state.products.filter((product) => product.id !== productId);
  state.movements = state.movements.filter((movement) => movement.productId !== productId);
  renderAll();
}

async function recordMovement({ productId, type, quantity, note }) {
  const product = state.products.find((item) => item.id === productId);
  const amount = Number(quantity);
  if (!product) throw new Error("请选择商品");
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("数量必须是大于 0 的整数");
  if (type === "out" && amount > stockFor(productId)) throw new Error("存出数量不能超过当前库存");

  const movement = {
    id: uid("movement"),
    productId,
    type,
    quantity: amount,
    note: note || (type === "in" ? "存入" : "存出"),
    createdAt: new Date().toISOString(),
  };
  await put(MOVEMENTS, movement);
  state.movements.push(movement);
  renderAll();
  return movement;
}

function resetProductForm() {
  $("#productForm").reset();
  $("#initialQuantity").value = "0";
  $("#productUnit").value = "瓶";
  $("#productImage").value = "";
  state.pendingImage = null;
  state.editingProductId = null;
  if (state.dialogImageUrl) URL.revokeObjectURL(state.dialogImageUrl);
  state.dialogImageUrl = null;
  $("#imagePreview").hidden = true;
  $("#imagePreview").removeAttribute("src");
  $("#imagePlaceholder").hidden = false;
  $("#productDialogEyebrow").textContent = "新建藏品";
  $("#productDialogTitle").textContent = "添加商品";
  $("#imagePromptText").textContent = "拍照或选择图片";
  $("#initialQuantityField").hidden = false;
  $("#initialQuantityField").closest(".field-row").classList.remove("edit-mode");
  $("#productSubmitButton").textContent = "保存商品";
}

function showProductImage(blob) {
  if (state.dialogImageUrl) URL.revokeObjectURL(state.dialogImageUrl);
  state.dialogImageUrl = blob ? URL.createObjectURL(blob) : null;
  $("#imagePreview").src = state.dialogImageUrl || "";
  $("#imagePreview").hidden = !blob;
  $("#imagePlaceholder").hidden = Boolean(blob);
}

function openProductDialog(productId = null) {
  resetProductForm();
  if (productId) {
    const product = state.products.find((item) => item.id === productId);
    if (!product) return showToast("没有找到这个商品");
    state.editingProductId = product.id;
    $("#productDialogEyebrow").textContent = "商品管理";
    $("#productDialogTitle").textContent = "编辑商品";
    $("#productName").value = product.name;
    const categoryInput = $(`input[name="category"][value="${product.category}"]`);
    if (categoryInput) categoryInput.checked = true;
    $("#productUnit").value = product.unit;
    $("#initialQuantityField").hidden = true;
    $("#initialQuantityField").closest(".field-row").classList.add("edit-mode");
    $("#productSubmitButton").textContent = "保存修改";
    $("#imagePromptText").textContent = "补拍或选择图片";
    showProductImage(product.image);
  }
  $("#productDialog").showModal();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    if (!blob) return resolve(null);
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  if (!dataUrl) return null;
  const [header, body] = dataUrl.split(",");
  const mime = header.match(/data:(.*?);base64/)?.[1] || "image/jpeg";
  const bytes = Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

async function exportBackup() {
  const products = await Promise.all(state.products.map(async (product) => ({
    ...product,
    image: await blobToDataUrl(product.image),
  })));
  const payload = {
    format: "collection-stock-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    products,
    movements: state.movements,
  };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `藏品库存备份-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
  showToast("备份文件已导出");
}

async function importBackup(file) {
  const payload = JSON.parse(await file.text());
  if (payload.format !== "collection-stock-backup" || !Array.isArray(payload.products) || !Array.isArray(payload.movements)) {
    throw new Error("不是有效的库存备份文件");
  }
  const products = payload.products.map((product) => ({ ...product, image: dataUrlToBlob(product.image) }));
  await replaceAll(products, payload.movements);
  state.products = products;
  state.movements = payload.movements;
  renderAll();
  showToast("备份已恢复");
}

function registerWebMcpTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;

  const report = (error) => console.warn("WebMCP tool registration failed", error);
  try {
    Promise.resolve(context.registerTool({
      name: "add_collection_product",
      title: "添加库存商品",
      description: "向个人烟酒茶库存中添加一个新商品，可设置初始数量。",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1 },
          category: { type: "string", enum: ["烟", "酒", "茶"] },
          unit: { type: "string", enum: ["件", "包", "条", "瓶", "盒", "箱", "罐", "饼"] },
          initialQuantity: { type: "integer", minimum: 0 }
        },
        required: ["name", "category", "unit", "initialQuantity"],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input) => {
        const product = await addProduct(input);
        return { id: product.id, name: product.name, stock: stockFor(product.id), unit: product.unit };
      }
    })).catch(report);

    Promise.resolve(context.registerTool({
      name: "record_stock_movement",
      title: "记录存入或存出",
      description: "为已有商品记录一笔存入或存出，并更新库存。",
      inputSchema: {
        type: "object",
        properties: {
          productId: { type: "string", minLength: 1 },
          type: { type: "string", enum: ["in", "out"] },
          quantity: { type: "integer", minimum: 1 }
        },
        required: ["productId", "type", "quantity"],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input) => {
        const movement = await recordMovement(input);
        return { id: movement.id, productId: movement.productId, stock: stockFor(movement.productId) };
      }
    })).catch(report);
  } catch (error) {
    report(error);
  }
}

async function initialize() {
  try {
    [state.products, state.movements] = await Promise.all([getAll(PRODUCTS), getAll(MOVEMENTS)]);
    renderAll();
    registerWebMcpTools();
  } catch (error) {
    console.error(error);
    showToast("本地数据打开失败，请刷新重试");
  }

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("Offline cache unavailable", error));
  }
}

document.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-nav]");
  if (nav) navigate(nav.dataset.nav);

  if (event.target.closest('[data-action="open-add-product"]')) {
    openProductDialog();
  }

  const editProduct = event.target.closest("[data-edit-product]");
  if (editProduct) openProductDialog(editProduct.dataset.editProduct);

  const deleteButton = event.target.closest("[data-delete-product]");
  if (deleteButton) {
    const product = state.products.find((item) => item.id === deleteButton.dataset.deleteProduct);
    if (product) {
      state.deletingProductId = product.id;
      $("#deleteProductName").textContent = product.name;
      $("#deleteDialog").showModal();
    }
  }

  const filter = event.target.closest("[data-category]");
  if (filter) {
    state.category = filter.dataset.category;
    $$("[data-category]").forEach((button) => button.classList.toggle("active", button === filter));
    renderAll();
  }

  const movement = event.target.closest("[data-movement]");
  if (movement) setMovementType(movement.dataset.movement);

  const step = event.target.closest("[data-step]");
  if (step) {
    const input = $("#recordQuantity");
    input.value = Math.max(1, Number(input.value || 1) + Number(step.dataset.step));
  }

  if (event.target.closest("[data-close-dialog]")) event.target.closest("dialog").close();
});

$("#backupButton").addEventListener("click", () => $("#backupDialog").showModal());
$("#recordProduct").addEventListener("change", updateStockHint);
$("#exportButton").addEventListener("click", exportBackup);

$("#confirmDeleteButton").addEventListener("click", async () => {
  const productId = state.deletingProductId;
  if (!productId) return;
  try {
    await deleteProduct(productId);
    $("#deleteDialog").close();
    showToast("商品及相关流水已删除");
  } catch (error) {
    showToast(error.message || "删除失败");
  }
});

$("#productImage").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    state.pendingImage = await compressImage(file);
    showProductImage(state.pendingImage);
  } catch {
    showToast("图片处理失败，请换一张图片");
  }
});

$("#productForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const editingProduct = state.products.find((item) => item.id === state.editingProductId);
    if (editingProduct) {
      await updateProduct({
        id: editingProduct.id,
        name: $("#productName").value,
        category: new FormData(event.currentTarget).get("category"),
        unit: $("#productUnit").value,
        image: state.pendingImage || editingProduct.image || null,
      });
    } else {
      await addProduct({
        name: $("#productName").value,
        category: new FormData(event.currentTarget).get("category"),
        unit: $("#productUnit").value,
        initialQuantity: Number($("#initialQuantity").value),
        image: state.pendingImage,
      });
    }
    $("#productDialog").close();
    resetProductForm();
    showToast(editingProduct ? "商品已更新" : "商品已添加");
  } catch (error) {
    showToast(error.message || "保存失败");
  }
});

$("#recordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await recordMovement({
      productId: $("#recordProduct").value,
      type: state.movementType,
      quantity: Number($("#recordQuantity").value),
    });
    $("#recordQuantity").value = "1";
    showToast(state.movementType === "in" ? "已存入" : "已存出");
  } catch (error) {
    showToast(error.message || "记录失败");
  }
});

$("#importInput").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await importBackup(file);
    $("#backupDialog").close();
  } catch (error) {
    showToast(error.message || "导入失败");
  } finally {
    event.target.value = "";
  }
});

$("#productDialog").addEventListener("close", resetProductForm);
$("#deleteDialog").addEventListener("close", () => {
  state.deletingProductId = null;
  $("#deleteProductName").textContent = "";
});

initialize();
