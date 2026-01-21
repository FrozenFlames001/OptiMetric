// -----------------------------
// CONFIG
// -----------------------------
const COIN_DIAMETER_MM = 24.0;
const MIN_CONTOUR_AREA = 500;
const PASS_THRESHOLD = 95.0;

// -----------------------------
// STATE
// -----------------------------
let masterPerimeter = null;
let measurementCount = 0;

// -----------------------------
// ELEMENTS
// -----------------------------
const masterBtn = document.getElementById("masterBtn");
const productBtn = document.getElementById("productBtn");
const masterInput = document.getElementById("masterInput");
const productInput = document.getElementById("productInput");
const preview = document.getElementById("preview");
const statusText = document.getElementById("status");

// NEW: Status Lights
const masterLight = document.getElementById("masterLight");
const productLight = document.getElementById("productLight");

// -----------------------------
// OPENCV READY
// -----------------------------
cv.onRuntimeInitialized = () => {
  statusText.textContent = "Ready. Capture MASTER sample.";
};

// -----------------------------
// UI EVENTS (WhisperFrames pattern)
// -----------------------------
masterBtn.onclick = () => masterInput.click();
productBtn.onclick = () => productInput.click();

masterInput.onchange = e => handleImage(e, true);
productInput.onchange = e => handleImage(e, false);

// -----------------------------
// IMAGE HANDLING
// -----------------------------
function handleImage(e, isMaster) {
  const file = e.target.files[0];
  if (!file) return;

  const img = new Image();
  img.onload = () => {
    preview.src = img.src;
    preview.classList.remove("hidden");
    document.querySelector(".hint").classList.add("hidden"); // Restore hint hiding

    const src = cv.imread(preview);
    try {
      const perimeter = measurePerimeter(src);

      if (isMaster) {
        masterPerimeter = perimeter;
        productBtn.disabled = false;
        statusText.innerHTML = `✅ MASTER stored`;

        // Switch Lights
        if (masterLight && productLight) {
          masterLight.classList.remove("active");
          productLight.classList.add("active");
        }
      } else {
        const match = computeMatch(perimeter, masterPerimeter);
        const verdict = match >= PASS_THRESHOLD ? "PASS ✅" : "FAIL ❌";
        statusText.innerHTML = `${verdict} — <span style="color:var(--text-main)">${match.toFixed(2)}% match</span>`;

        // Add to History
        addToHistory(img.src, match, match >= PASS_THRESHOLD, perimeter, masterPerimeter);
      }
    } catch {
      statusText.textContent = "❌ Detection failed. Retake photo.";
    }
    src.delete();
  };

  img.src = URL.createObjectURL(file);
}

// -----------------------------
// CORE LOGIC (FROM PYTHON)
// -----------------------------
function circularity(c) {
  const area = cv.contourArea(c);
  const peri = cv.arcLength(c, true);
  return peri === 0 ? 0 : 4 * Math.PI * area / (peri * peri);
}

function measurePerimeter(src) {
  let gray = new cv.Mat();
  let binary = new cv.Mat();

  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.threshold(
    gray, binary, 0, 255,
    cv.THRESH_BINARY_INV + cv.THRESH_OTSU
  );

  let kernel = cv.getStructuringElement(
    cv.MORPH_RECT, new cv.Size(5, 5)
  );
  cv.morphologyEx(binary, binary, cv.MORPH_CLOSE, kernel);

  let contours = new cv.MatVector();
  let hierarchy = new cv.Mat();
  cv.findContours(
    binary, contours, hierarchy,
    cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE
  );

  let valid = [];
  for (let i = 0; i < contours.size(); i++) {
    let c = contours.get(i);
    if (cv.contourArea(c) > MIN_CONTOUR_AREA) valid.push(c);
  }

  if (valid.length < 2) throw "Not enough contours";

  let coin = valid
    .map(c => ({
      c,
      score: Math.abs(circularity(c) - 1),
      area: cv.contourArea(c)
    }))
    .sort((a, b) => a.score - b.score || b.area - a.area)[0].c;

  let circle = cv.minEnclosingCircle(coin);
  let pxPerMM = (2 * circle.radius) / COIN_DIAMETER_MM;

  let object = valid
    .filter(c => c !== coin)
    .sort((a, b) => cv.contourArea(b) - cv.contourArea(a))[0];

  let periPx = cv.arcLength(object, true);
  let periMM = periPx / pxPerMM;

  gray.delete(); binary.delete(); contours.delete(); hierarchy.delete();
  return periMM;
}

function computeMatch(product, master) {
  const diff = Math.abs(product - master);
  return Math.max(0, 100 - (diff / master) * 100);
}

function addToHistory(imgSrc, match, passed, productP, masterP) {
  measurementCount++;
  const section = document.getElementById("history-section");
  const tbody = document.getElementById("history-body");

  if (section.classList.contains("hidden")) {
    section.classList.remove("hidden");
  }

  // Determine Reason
  let reason = "Perfect Match";
  if (!passed) {
    const diff = productP - masterP;
    const percentDiff = ((diff / masterP) * 100).toFixed(1);
    if (diff > 0) reason = `Too Large (+${percentDiff}%)`;
    else reason = `Too Small (${percentDiff}%)`;
  } else if (match < 100) {
    reason = "Within Tolerance";
  }

  const row = document.createElement("tr");
  row.innerHTML = `
    <td>#${measurementCount}</td>
    <td><img src="${imgSrc}" class="history-img" alt="Product ${measurementCount}"></td>
    <td><strong>${match.toFixed(1)}%</strong></td>
    <td>
      <span class="status-badge ${passed ? 'status-pass' : 'status-fail'}">
        ${passed ? 'PASS' : 'FAIL'}
      </span>
    </td>
    <td style="color:var(--text-gray)">${reason}</td>
  `;

  // Insert at top
  tbody.insertBefore(row, tbody.firstChild);
}

