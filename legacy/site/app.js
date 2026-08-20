function configurarFavicon() {
  let favicon = document.querySelector("link[rel='icon']");

  if (!favicon) {
    favicon = document.createElement("link");
    favicon.rel = "icon";
    favicon.type = "image/png";
    document.head.appendChild(favicon);
  }

  favicon.href = "/img/favicon.png";
}

const WEBAPP_URL_RETIDOS = "https://script.google.com/macros/s/AKfycbxAtx7N-bdqh2719R2Iw0gDw-dpo5270285kvHuutEE537oQhqxZm5PEAGln0372XHj/exec";

async function iniciarMenu(paginaAtual) {
  configurarFavicon();

  if (!document.getElementById("sideMenu")) {
    const resp = await fetch("/menu.html?ts=" + Date.now(), { cache: "no-store" });
    const html = await resp.text();
    document.body.insertAdjacentHTML("afterbegin", html);
  }

  const btnAbrirMenu = document.getElementById("btnAbrirMenu");
  const btnFecharMenu = document.getElementById("btnFecharMenu");
  const sideMenu = document.getElementById("sideMenu");
  const menuOverlay = document.getElementById("menuOverlay");

  if (!btnAbrirMenu || !btnFecharMenu || !sideMenu || !menuOverlay) {
    console.warn("Menu não carregado corretamente");
    return;
  }

  function abrirMenu() {
    sideMenu.classList.add("aberto");
    menuOverlay.classList.add("aberto");
  }

  function fecharMenu() {
    sideMenu.classList.remove("aberto");
    menuOverlay.classList.remove("aberto");
  }

  btnAbrirMenu.onclick = abrirMenu;
  btnFecharMenu.onclick = fecharMenu;
  menuOverlay.onclick = fecharMenu;

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") fecharMenu();
  });

  document.querySelectorAll(".menu-links a").forEach(link => {
    link.classList.remove("ativo");
    if (link.dataset.page === paginaAtual) {
      link.classList.add("ativo");
    }
  });

  const usuario = localStorage.getItem("mvf_usuario_nome") || "Usuário";
  const maquina = localStorage.getItem("mvf_maquina_id") || "Máquina";

  const menuUsuario = document.getElementById("menuUsuario");
  const menuMaquina = document.getElementById("menuMaquina");

  if (menuUsuario) menuUsuario.textContent = usuario;
  if (menuMaquina) menuMaquina.textContent = maquina;

  atualizarBadges();
}

async function atualizarBadges() {
  try {
    if (!WEBAPP_URL_RETIDOS) return;

    const resp = await fetch(
      WEBAPP_URL_RETIDOS + "?acao=listarRetidosAguardando&t=" + Date.now()
    );

    if (!resp.ok) {
      throw new Error("HTTP " + resp.status);
    }

    const texto = await resp.text();
    let data = {};

    try {
      data = JSON.parse(texto);
    } catch (e) {
      console.warn("Resposta do badge não é JSON válido.");
      return;
    }

    const total = Array.isArray(data.rows) ? data.rows.length : 0;

    const badgeRetidos = document.getElementById("badgeRetidos");
    if (badgeRetidos) {
      badgeRetidos.textContent = total;
      badgeRetidos.style.display = total ? "inline-block" : "none";
    }
  } catch (e) {
    console.warn("Erro ao atualizar badges:", e.message || e);
  }
}
