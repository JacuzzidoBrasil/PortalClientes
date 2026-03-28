import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import "./App.css";
import jacuzziWhiteLogo from "../Jacuzzi branco.png";
import deepDiveLogo from "../DeepDive.png";
import expressLogo from "../Express.png";
import grow2getherLogo from "../Grow2Gether.png";
import restoreYouLogo from "../RestoreYou.png";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const TEST_CALCULATED_CNPJ = "058352792000143";
const CALCULATED_SHEET_ID = "pricing-v2-calculated";
const CALCULATED_SHEET_TITLE = "TABELA DE PRECO CALCULADA";
const UF_CODES = [
  "AC",
  "AL",
  "AM",
  "AP",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MG",
  "MS",
  "MT",
  "PA",
  "PB",
  "PE",
  "PI",
  "PR",
  "RJ",
  "RN",
  "RO",
  "RR",
  "RS",
  "SC",
  "SE",
  "SP",
  "TO",
];

function authHeaders(token) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

function normalizeCnpj(value) {
  return String(value || "").replace(/\D/g, "");
}

function isCalculatedSheetId(id) {
  return String(id || "").startsWith("pricing-v2:");
}

function getCalcParams(id) {
  const parts = String(id || "").split(":");
  return { programa: parts[1] || "", categoria: parts[2] || "" };
}

function getProgramLogos(accessLevels = []) {
  const normalized = accessLevels.map((level) =>
    String(level || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()
  );

  const logos = [];
  if (normalized.some((level) => level.includes("express"))) {
    logos.push({ src: expressLogo, alt: "Express" });
  }
  if (normalized.some((level) => level.includes("grow2gether"))) {
    logos.push({ src: grow2getherLogo, alt: "Grow2Gether" });
  }
  if (normalized.some((level) => level.includes("deep dive"))) {
    logos.push({ src: deepDiveLogo, alt: "Deep Dive" });
  }
  if (normalized.some((level) => level.includes("restore you"))) {
    logos.push({ src: restoreYouLogo, alt: "Restore You" });
  }
  return logos;
}

const BUSY_LABELS = {
  login: "Entrando no portal...",
  firstAccessRequest: "Enviando codigo de primeiro acesso...",
  firstAccessConfirm: "Definindo sua nova senha...",
  resetRequest: "Enviando codigo de redefinicao...",
  resetConfirm: "Atualizando sua senha...",
  createUser: "Criando usuario...",
};

export default function App() {
  const [cnpj, setCnpj] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(localStorage.getItem("token"));
  const [me, setMe] = useState(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("error");
  const [busyAction, setBusyAction] = useState("");

  const [showFirstAccess, setShowFirstAccess] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [firstAccessForm, setFirstAccessForm] = useState({
    cnpj: "",
    email: "",
    code: "",
    new_password: "",
  });
  const [firstAccessTermsAccepted, setFirstAccessTermsAccepted] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [resetForm, setResetForm] = useState({
    cnpj: "",
    email: "",
    code: "",
    new_password: "",
  });

  const [spreadsheets, setSpreadsheets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [table, setTable] = useState({ columns: [], rows: [] });
  const [pricingUf, setPricingUf] = useState("");
  const [search, setSearch] = useState("");
  const [searchCol, setSearchCol] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 100;

  const [accessLevels, setAccessLevels] = useState([]);
  const [users, setUsers] = useState([]);
  const [adminSheets, setAdminSheets] = useState([]);
  const [adminInvoices, setAdminInvoices] = useState([]);

  const [newUser, setNewUser] = useState({
    cnpj: "",
    name: "",
    email: "",
    uf: "",
    password: "",
    is_admin: false,
    access_level_ids: [],
  });

  const [editUserId, setEditUserId] = useState("");
  const [editAccessIds, setEditAccessIds] = useState([]);

  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadAccessIds, setUploadAccessIds] = useState([]);
  const programLogos = useMemo(() => getProgramLogos(me?.access_levels || []), [me]);
  const canUseCalculatedPricing = normalizeCnpj(me?.cnpj) === TEST_CALCULATED_CNPJ;

  useEffect(() => {
    if (token) {
      loadMe();
    }
  }, [token]);

  useEffect(() => {
    if (!editUserId) {
      setEditAccessIds([]);
      return;
    }
    const u = users.find((x) => String(x.id) === String(editUserId));
    if (u) {
      setEditAccessIds(u.access_levels.map((a) => a.id));
    }
  }, [editUserId, users]);

  useEffect(() => {
    if (token && me?.is_admin) {
      loadAdminInvoices();
    }
  }, [token, me?.is_admin]);

  useEffect(() => {
    if (!me?.uf) {
      setPricingUf("");
      return;
    }
    setPricingUf((current) => current || me.uf);
  }, [me?.uf]);

  function setError(msg) {
    setMessageTone("error");
    setMessage(msg);
  }

  function setSuccess(msg) {
    setMessageTone("ok");
    setMessage(msg);
  }

  function getErrorDetail(err) {
    const detail = err?.response?.data?.detail;
    return typeof detail === "string" ? detail : "";
  }

  function getLoginMessage(err) {
    const detail = getErrorDetail(err);
    if (detail === "User inactive") {
      return "Seu usuario esta inativo. Fale com o administrador para reativar o acesso.";
    }
    return "CNPJ ou senha invalidos. Se este for seu primeiro acesso, use o botao 'Primeiro acesso'.";
  }

  function getCreateUserMessage(err) {
    const detail = getErrorDetail(err);
    if (detail === "CNPJ already exists") {
      return "Ja existe um usuario cadastrado com esse CNPJ.";
    }
    if (detail === "UF invalid") {
      return "A UF informada e invalida. Escolha uma UF valida para concluir o cadastro.";
    }
    return "Nao foi possivel criar o usuario. Revise os dados obrigatorios e tente novamente.";
  }

  function getFirstAccessConfirmMessage(err) {
    const detail = getErrorDetail(err);
    if (detail === "User not found") {
      return "Nao encontramos um usuario ativo com esse CNPJ e email para concluir o primeiro acesso.";
    }
    if (detail === "First access code not requested") {
      return "Solicite o codigo de primeiro acesso antes de tentar definir a senha.";
    }
    if (detail === "Code expired") {
      return "O codigo de primeiro acesso expirou. Solicite um novo codigo.";
    }
    if (detail === "Invalid code") {
      return "O codigo de primeiro acesso informado nao confere. Revise e tente novamente.";
    }
    return "Nao foi possivel concluir o primeiro acesso. Confira CNPJ, email, codigo e a nova senha.";
  }

  function getResetConfirmMessage(err) {
    const detail = getErrorDetail(err);
    if (detail === "User not found") {
      return "Nao encontramos um usuario ativo com esse CNPJ e email para redefinir a senha.";
    }
    if (detail === "Reset code not requested") {
      return "Solicite o codigo de redefinicao antes de tentar trocar a senha.";
    }
    if (detail === "Code expired") {
      return "O codigo de redefinicao expirou. Solicite um novo codigo.";
    }
    if (detail === "Invalid code") {
      return "O codigo de redefinicao informado nao confere. Revise e tente novamente.";
    }
    return "Nao foi possivel redefinir a senha. Confira CNPJ, email, codigo e a nova senha.";
  }

  const busyLabel = busyAction ? BUSY_LABELS[busyAction] || "Carregando..." : "";
  const loadingOverlay = busyAction ? (
    <div className="loading-overlay">
      <div className="loading-card">
        <div className="loading-spinner" />
        <strong>{busyLabel}</strong>
        <span>Aguarde alguns instantes.</span>
      </div>
    </div>
  ) : null;

  async function loadMe() {
    try {
      const res = await axios.get(`${API_URL}/auth/me`, authHeaders(token));
      setMe(res.data);
    } catch (err) {
      setError("Sessao expirada. Faca login novamente.");
      setToken(null);
      localStorage.removeItem("token");
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setMessage("");
    setBusyAction("login");
    try {
      const res = await axios.post(`${API_URL}/auth/login`, { cnpj, password });
      setToken(res.data.access_token);
      localStorage.setItem("token", res.data.access_token);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      const status = err?.response?.status;
      if (detail === "First access required" || status === 403) {
        setError("Primeiro acesso necessario. Informe email e codigo.");
        setShowFirstAccess(true);
        setShowReset(false);
        setFirstAccessForm((old) => ({ ...old, cnpj, email: "" }));
        return;
      }
      setError(getLoginMessage(err));
    } finally {
      setBusyAction("");
    }
  }

  function handleLogout() {
    setToken(null);
    setMe(null);
    setPricingUf("");
    localStorage.removeItem("token");
  }

  async function loadSpreadsheets() {
    try {
      const res = await axios.get(`${API_URL}/spreadsheets`, authHeaders(token));
      const baseItems = Array.isArray(res.data) ? [...res.data] : [];
      if (!me?.is_admin && canUseCalculatedPricing) {
        const calcRes = await axios.get(`${API_URL}/pricing-v2/my-tables`, authHeaders(token));
        const calcItems = Array.isArray(calcRes.data?.items) ? calcRes.data.items : [];
        const merged = [...calcItems, ...baseItems];
        setSpreadsheets(merged);
        return;
      }
      setSpreadsheets(baseItems);
    } catch {
      setError("Erro ao carregar planilhas.");
    }
  }

  async function loadData(id, reset = false, overrideUf = "") {
    const nextOffset = reset ? 0 : offset;
    setSelectedId(id);
    const params = {
      limit,
      offset: nextOffset,
    };
    if (search) params.search = search;
    if (searchCol) params.col = searchCol;
    try {
      let endpoint = `${API_URL}/spreadsheets/${id}/data`;
      if (isCalculatedSheetId(id)) {
        endpoint = `${API_URL}/pricing-v2/my-table/data`;
        const calc = getCalcParams(id);
        params.programa = calc.programa;
        params.categoria = calc.categoria;
        if (overrideUf || pricingUf) {
          params.uf = overrideUf || pricingUf;
        }
      }
      const res = await axios.get(endpoint, {
        ...authHeaders(token),
        params,
      });
      setTable(res.data);
      if (reset) setOffset(0);
    } catch {
      setError("Erro ao carregar dados da planilha.");
    }
  }

  function nextPage() {
    const next = offset + limit;
    setOffset(next);
    if (selectedId) loadData(selectedId);
  }

  async function downloadSheet(id, format) {
    try {
      let endpoint = `${API_URL}/spreadsheets/${id}/download?format=${format}`;
      if (isCalculatedSheetId(id)) {
        const calc = getCalcParams(id);
        endpoint = `${API_URL}/pricing-v2/my-table/download?format=${format}&programa=${encodeURIComponent(calc.programa)}&categoria=${encodeURIComponent(calc.categoria)}`;
        if (pricingUf) {
          endpoint += `&uf=${encodeURIComponent(pricingUf)}`;
        }
      }
      const res = await axios.get(endpoint, {
        ...authHeaders(token),
        responseType: "blob",
      });
      const disposition = res.headers["content-disposition"] || "";
      const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const simpleMatch = disposition.match(/filename=\"?([^\";]+)\"?/i);
      const fromHeader = utf8Match?.[1] ? decodeURIComponent(utf8Match[1]) : simpleMatch?.[1];
      const sheet = spreadsheets.find((item) => item.id === id);
      const fallback = sheet ? `${sheet.title}.${format === "csv" ? "csv" : "xlsx"}` : `planilha.${format === "csv" ? "csv" : "xlsx"}`;
      const blob = new Blob([res.data]);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fromHeader || fallback;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setError("Erro ao baixar planilha.");
    }
  }

  async function loadAdminData() {
    try {
      const [levelsRes, usersRes, sheetsRes] = await Promise.all([
        axios.get(`${API_URL}/admin/access-levels`, authHeaders(token)),
        axios.get(`${API_URL}/admin/users`, authHeaders(token)),
        axios.get(`${API_URL}/admin/spreadsheets`, authHeaders(token)),
      ]);
      setAccessLevels(levelsRes.data);
      setUsers(usersRes.data);
      setAdminSheets(sheetsRes.data);
    } catch {
      setError("Erro ao carregar dados de administracao.");
    }
  }

  async function handleCreateUser(e) {
    e.preventDefault();
    setMessage("");
    if (!newUser.uf) {
      setError("Selecione a UF do usuario.");
      return;
    }
    setBusyAction("createUser");
    try {
      await axios.post(`${API_URL}/admin/users`, newUser, authHeaders(token));
      setNewUser({ cnpj: "", name: "", email: "", uf: "", password: "", is_admin: false, access_level_ids: [] });
      await loadAdminData();
      setSuccess("Usuario criado com sucesso. Ele ainda precisara concluir o primeiro acesso para definir a senha final.");
    } catch (err) {
      setError(getCreateUserMessage(err));
    } finally {
      setBusyAction("");
    }
  }

  async function handleUpdateUserAccess(e) {
    e.preventDefault();
    if (!editUserId) return;
    setMessage("");
    try {
      await axios.put(
        `${API_URL}/admin/users/${editUserId}/access-levels`,
        { access_level_ids: editAccessIds },
        authHeaders(token)
      );
      await loadAdminData();
      setSuccess("Permissoes atualizadas.");
    } catch {
      setError("Erro ao atualizar permissoes.");
    }
  }

  async function handleDeleteUser(id) {
    if (!window.confirm("Excluir este usuario?")) return;
    try {
      await axios.delete(`${API_URL}/admin/users/${id}`, authHeaders(token));
      await loadAdminData();
      setSuccess("Usuario excluido.");
    } catch {
      setError("Erro ao excluir usuario.");
    }
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (!uploadFile) {
      setError("Selecione uma planilha.");
      return;
    }
    const form = new FormData();
    form.append("title", uploadTitle);
    form.append("access_level_ids", uploadAccessIds.join(","));
    form.append("file", uploadFile);

    setMessage("");
    try {
      await axios.post(`${API_URL}/admin/spreadsheets`, form, authHeaders(token));
      setUploadTitle("");
      setUploadFile(null);
      setUploadAccessIds([]);
      await loadAdminData();
      setSuccess("Planilha enviada.");
    } catch {
      setError("Erro ao enviar planilha.");
    }
  }

  async function handleDeleteSheet(id) {
    if (!window.confirm("Excluir esta planilha?")) return;
    try {
      await axios.delete(`${API_URL}/admin/spreadsheets/${id}`, authHeaders(token));
      await loadAdminData();
      setSuccess("Planilha excluida.");
    } catch {
      setError("Erro ao excluir planilha.");
    }
  }

  async function loadAdminInvoices() {
    try {
      const res = await axios.get(`${API_URL}/invoices/admin`, authHeaders(token));
      setAdminInvoices(res.data);
    } catch {
      setError("Erro ao carregar notas.");
    }
  }

  async function downloadInvoice(id, invoiceNumber) {
    try {
      const res = await axios.get(`${API_URL}/invoices/${id}/download`, {
        ...authHeaders(token),
        responseType: "blob",
      });
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoiceNumber || "nota"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setError("Erro ao baixar nota.");
    }
  }

  async function requestFirstAccessCode() {
    setMessage("");
    setBusyAction("firstAccessRequest");
    try {
      await axios.post(`${API_URL}/auth/first-access/request`, {
        cnpj: firstAccessForm.cnpj,
        email: firstAccessForm.email,
      });
      setSuccess("Se o CNPJ e o email estiverem cadastrados e ativos, o codigo de primeiro acesso foi enviado para o email informado.");
    } catch (err) {
      setError(getErrorDetail(err) || "Nao foi possivel solicitar o primeiro acesso. Verifique a configuracao de email do servidor.");
    } finally {
      setBusyAction("");
    }
  }

  async function confirmFirstAccess() {
    if (!firstAccessTermsAccepted) {
      setError("Voce precisa aceitar os Termos de Uso para continuar.");
      return;
    }
    setMessage("");
    setBusyAction("firstAccessConfirm");
    try {
      await axios.post(`${API_URL}/auth/first-access/confirm`, firstAccessForm);
      setSuccess("Senha definida com sucesso. Agora voce ja pode entrar no portal com a nova senha.");
      setShowFirstAccess(false);
      setFirstAccessTermsAccepted(false);
    } catch (err) {
      setError(getFirstAccessConfirmMessage(err));
    } finally {
      setBusyAction("");
    }
  }

  async function requestResetCode() {
    setMessage("");
    setBusyAction("resetRequest");
    try {
      await axios.post(`${API_URL}/auth/password-reset/request`, {
        cnpj: resetForm.cnpj,
        email: resetForm.email,
      });
      setSuccess("Se o CNPJ e o email estiverem cadastrados e ativos, o codigo de redefinicao foi enviado para o email informado.");
    } catch (err) {
      setError(getErrorDetail(err) || "Nao foi possivel solicitar a redefinicao de senha. Verifique a configuracao de email do servidor.");
    } finally {
      setBusyAction("");
    }
  }

  async function confirmReset() {
    setMessage("");
    setBusyAction("resetConfirm");
    try {
      await axios.post(`${API_URL}/auth/password-reset/confirm`, resetForm);
      setSuccess("Senha atualizada com sucesso. Agora voce ja pode entrar com a nova senha.");
      setShowReset(false);
    } catch (err) {
      setError(getResetConfirmMessage(err));
    } finally {
      setBusyAction("");
    }
  }

  const userOptions = useMemo(() => users.map((u) => ({ id: u.id, label: `${u.name} (${u.cnpj})` })), [users]);
  if (!token) {
    return (
      <div className="page">
        {loadingOverlay}
        <div className="login-wrap">
          <section className="login-card">
            <div className="login-side">
              <img src={jacuzziWhiteLogo} alt="Jacuzzi" className="login-jacuzzi" />
              <h1>Portal Clientes Jacuzzi</h1>
              <p className="panel-subtitle">Use CNPJ e senha para acessar.</p>
              <form onSubmit={handleLogin} className="form-grid">
                <input className="field" placeholder="CNPJ" value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
                <input
                  className="field"
                  placeholder="Senha"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button className="btn login-enter" type="submit" disabled={busyAction === "login"}>
                  {busyAction === "login" ? "Entrando..." : "Entrar"}
                </button>
              </form>

              {message && <div className={`message ${messageTone}`}>{message}</div>}

              <div className="switch-row">
                <button
                  className="btn first-access"
                  type="button"
                  onClick={() => {
                    setShowFirstAccess(!showFirstAccess);
                    setShowReset(false);
                    if (showFirstAccess) {
                      setFirstAccessTermsAccepted(false);
                    }
                  }}
                >
                  Primeiro acesso
                </button>
                <button
                  className="btn reset-access"
                  type="button"
                  onClick={() => {
                    setShowReset(!showReset);
                    setShowFirstAccess(false);
                  }}
                >
                  Recuperar senha
                </button>
              </div>

              {showFirstAccess && (
                <div className="auth-flow">
                  <strong>Primeiro acesso</strong>
                  <input
                    className="field"
                    placeholder="CNPJ"
                    value={firstAccessForm.cnpj}
                    onChange={(e) => setFirstAccessForm({ ...firstAccessForm, cnpj: e.target.value })}
                  />
                  <input
                    className="field"
                    placeholder="Email"
                    value={firstAccessForm.email}
                    onChange={(e) => setFirstAccessForm({ ...firstAccessForm, email: e.target.value })}
                  />
                  <button className="btn alt" type="button" onClick={requestFirstAccessCode} disabled={busyAction === "firstAccessRequest"}>
                    {busyAction === "firstAccessRequest" ? "Enviando codigo..." : "Enviar codigo"}
                  </button>
                  <input
                    className="field"
                    placeholder="Codigo recebido"
                    value={firstAccessForm.code}
                    onChange={(e) => setFirstAccessForm({ ...firstAccessForm, code: e.target.value })}
                  />
                  <input
                    className="field"
                    placeholder="Nova senha"
                    type="password"
                    value={firstAccessForm.new_password}
                    onChange={(e) => setFirstAccessForm({ ...firstAccessForm, new_password: e.target.value })}
                  />
                  <label className="terms-check">
                    <input
                      type="checkbox"
                      checked={firstAccessTermsAccepted}
                      onChange={(e) => setFirstAccessTermsAccepted(e.target.checked)}
                    />
                    <span>
                      Li e concordo com os Termos de Uso.{" "}
                      <button className="terms-link" type="button" onClick={() => setShowTermsModal(true)}>
                        (Ver termos)
                      </button>
                    </span>
                  </label>
                  <button
                    className="btn"
                    type="button"
                    onClick={confirmFirstAccess}
                    disabled={!firstAccessTermsAccepted || busyAction === "firstAccessConfirm"}
                  >
                    {busyAction === "firstAccessConfirm" ? "Definindo senha..." : "Confirmar primeiro acesso"}
                  </button>
                </div>
              )}

              {showTermsModal && (
                <div className="terms-modal-backdrop" onClick={() => setShowTermsModal(false)}>
                  <div className="terms-modal" onClick={(e) => e.stopPropagation()}>
                    <h3>Termo de Compromisso e Confidencialidade</h3>
                    <p>
                      Ao acessar esta plataforma, concordo e declaro estar ciente das seguintes obrigações relativas à
                      segurança da informação e proteção de dados:
                    </p>
                    <p>
                      <strong>1.</strong>
                      <br />
                      Não Compartilhamento: Comprometo-me a não compartilhar, ceder ou vender meu nome de usuário e
                      senha a terceiros sob qualquer pretexto.
                      <br />
                      Responsabilidade: Entendo que o acesso à conta é de minha exclusiva responsabilidade e que
                      qualquer atividade realizada com minhas credenciais será atribuída a mim.
                    </p>
                    <p>
                      <strong>2.</strong>
                      <br />
                      Uso Exclusivo: Todo o conteúdo disponível neste site (textos, vídeos, imagens, metodologias e
                      materiais) é para uso pessoal e não comercial.
                      <br />
                      Finalidade: Os dados coletados para o acesso são utilizados estritamente para a prestação do
                      serviço e segurança da plataforma, conforme o Art. 7º da Lei 13.709/2018.
                      <br />
                      Segurança: O site adota medidas técnicas para proteger o acesso, mas a segurança também depende
                      da guarda cuidadosa da sua senha pelo usuário.
                    </p>
                    <button className="btn" type="button" onClick={() => setShowTermsModal(false)}>
                      Fechar
                    </button>
                  </div>
                </div>
              )}

              {showReset && (
                <div className="auth-flow">
                  <strong>Recuperar senha</strong>
                  <input
                    className="field"
                    placeholder="CNPJ"
                    value={resetForm.cnpj}
                    onChange={(e) => setResetForm({ ...resetForm, cnpj: e.target.value })}
                  />
                  <input
                    className="field"
                    placeholder="Email"
                    value={resetForm.email}
                    onChange={(e) => setResetForm({ ...resetForm, email: e.target.value })}
                  />
                  <button className="btn alt" type="button" onClick={requestResetCode} disabled={busyAction === "resetRequest"}>
                    {busyAction === "resetRequest" ? "Enviando codigo..." : "Enviar codigo"}
                  </button>
                  <input
                    className="field"
                    placeholder="Codigo recebido"
                    value={resetForm.code}
                    onChange={(e) => setResetForm({ ...resetForm, code: e.target.value })}
                  />
                  <input
                    className="field"
                    placeholder="Nova senha"
                    type="password"
                    value={resetForm.new_password}
                    onChange={(e) => setResetForm({ ...resetForm, new_password: e.target.value })}
                  />
                  <button className="btn" type="button" onClick={confirmReset} disabled={busyAction === "resetConfirm"}>
                    {busyAction === "resetConfirm" ? "Atualizando senha..." : "Confirmar recuperacao"}
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {loadingOverlay}
      <div className="app-shell">
        <header className="topbar">
          <div className="topbar-main">
            <img src={jacuzziWhiteLogo} alt="Jacuzzi" className="jacuzzi-banner" />
            <h1 className="title">Portal Clientes Jacuzzi</h1>
          </div>
          <div className="topbar-right">
            <button className="btn logout-btn" onClick={handleLogout}>
              Sair
            </button>
          </div>
        </header>

        {message && <div className={`message ${messageTone}`}>{message}</div>}

        <div className={`grid-main ${me?.is_admin ? "" : "single-column"}`}>
          <section className="card card-spreadsheets">
            <h2>Planilhas</h2>
            <div className="planilha-toolbar">
              <div className="planilha-searches">
                <div className="search-inputs">
                  {canUseCalculatedPricing && (
                    <div className="pricing-uf-picker">
                      <label className="pricing-uf-label" htmlFor="pricing-uf-select">
                        UF para teste da tabela calculada
                      </label>
                      <select
                        id="pricing-uf-select"
                        className="field half-field"
                        value={pricingUf}
                        onChange={(e) => {
                          const nextUf = e.target.value;
                          setPricingUf(nextUf);
                          if (selectedId && isCalculatedSheetId(selectedId)) {
                            loadData(selectedId, true, nextUf);
                          }
                        }}
                      >
                        <option value="">Selecione a UF</option>
                        {UF_CODES.map((uf) => (
                          <option key={uf} value={uf}>
                            {uf}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <input
                    className="field half-field"
                    placeholder="Buscar na tabela"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <input
                    className="field half-field"
                    placeholder="Coluna opcional"
                    value={searchCol}
                    onChange={(e) => setSearchCol(e.target.value)}
                  />
                </div>
                <div className="programa-info">
                  <p className="subtitle programa-text">
                    {me ? `Bem-vindo, ${me.name},` : "Bem-vindo,"}
                    <br />
                    seu programa comercial é:
                  </p>
                  {programLogos.map((logo) => (
                    <img key={logo.alt} src={logo.src} alt={logo.alt} className="access-logo access-logo-large" />
                  ))}
                </div>
              </div>
              <div className="row planilha-actions">
                <button className="btn load-sheets" onClick={loadSpreadsheets}>
                  Carregar planilhas
                </button>
                <button className="btn" onClick={() => selectedId && loadData(selectedId, true)}>
                  Buscar
                </button>
                <p className="confidential-note">
                  O conteudo deste site é confidencial e não deve ser compartilhado.
                </p>
              </div>
            </div>

            <ul className="list">
              {spreadsheets.map((it) => (
                <li className="item" key={it.id}>
                  <strong className="sheet-title">{it.title}</strong>
                  <div className="row">
                    <button className="btn ghost" onClick={() => loadData(it.id, true)}>
                      Abrir
                    </button>
                    <button className="btn alt" onClick={() => downloadSheet(it.id, "excel")}>
                      Excel
                    </button>
                    <button className="btn alt" onClick={() => downloadSheet(it.id, "csv")}>
                      CSV
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            {selectedId && (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {table.columns.map((c) => (
                          <th key={c}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((row, idx) => (
                        <tr key={idx}>
                          {table.columns.map((c) => (
                            <td key={c}>{row[c]}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginTop: 10 }}>
                  <button className="btn" onClick={nextPage}>
                    Proxima pagina
                  </button>
                </div>
              </>
            )}

            <div className="notes-section">
              <h3>Minhas notas</h3>
              {me?.is_admin ? (
                <>
                  <div className="row" style={{ marginBottom: 8 }}>
                    <button className="btn alt" type="button" onClick={loadAdminInvoices}>
                      Atualizar notas
                    </button>
                  </div>
                  <ul className="list">
                    {adminInvoices.map((inv) => (
                      <li className="item" key={inv.id}>
                        <span>
                          {inv.invoice_number} - {inv.cnpj}
                          {inv.invoice_date ? ` - ${inv.invoice_date}` : ""}
                        </span>
                        <button className="btn ghost" type="button" onClick={() => downloadInvoice(inv.id, inv.invoice_number)}>
                          Abrir PDF
                        </button>
                      </li>
                    ))}
                    {!adminInvoices.length && <li className="item">Nenhuma nota encontrada.</li>}
                  </ul>
                </>
              ) : (
                <p className="notes-dev">em desenvolvimento</p>
              )}
            </div>
          </section>

          {me?.is_admin && (
            <section className="card">
              <div className="row">
                <h2>Administracao</h2>
                <button className="btn load-admin" onClick={loadAdminData}>
                  Carregar dados admin
                </button>
              </div>
              <p className="muted">Gestao de usuarios, acessos e planilhas.</p>

              <div className="card" style={{ marginTop: 12 }}>
                <h3>Criar usuario</h3>
                <form onSubmit={handleCreateUser} className="form-grid">
                  <input
                    className="field"
                    placeholder="CNPJ"
                    value={newUser.cnpj}
                    onChange={(e) => setNewUser({ ...newUser, cnpj: e.target.value })}
                  />
                  <input
                    className="field"
                    placeholder="Nome"
                    value={newUser.name}
                    onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  />
                  <input
                    className="field"
                    placeholder="Email"
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  />
                  <select
                    className="field"
                    value={newUser.uf}
                    onChange={(e) => setNewUser({ ...newUser, uf: e.target.value })}
                  >
                    <option value="">UF</option>
                    {UF_CODES.map((uf) => (
                      <option key={uf} value={uf}>
                        {uf}
                      </option>
                    ))}
                  </select>
                  <input
                    className="field"
                    placeholder="Senha inicial"
                    type="password"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  />
                  <label>
                    <input
                      type="checkbox"
                      checked={newUser.is_admin}
                      onChange={(e) => setNewUser({ ...newUser, is_admin: e.target.checked })}
                    />{" "}
                    Admin
                  </label>
                  <div>
                    <strong>Acessos</strong>
                    <div className="checkbox-grid">
                      {accessLevels.map((al) => (
                        <label key={al.id}>
                          <input
                            type="checkbox"
                            checked={newUser.access_level_ids.includes(al.id)}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...newUser.access_level_ids, al.id]
                                : newUser.access_level_ids.filter((id) => id !== al.id);
                              setNewUser({ ...newUser, access_level_ids: next });
                            }}
                          />{" "}
                          {al.name}
                        </label>
                      ))}
                    </div>
                  </div>
                  <button className="btn" type="submit" disabled={busyAction === "createUser"}>
                    {busyAction === "createUser" ? "Criando usuario..." : "Criar usuario"}
                  </button>
                </form>
              </div>

              <div className="card" style={{ marginTop: 12 }}>
                <h3>Atualizar permissoes</h3>
                <form onSubmit={handleUpdateUserAccess} className="form-grid">
                  <select className="field" value={editUserId} onChange={(e) => setEditUserId(e.target.value)}>
                    <option value="">Selecione um usuario</option>
                    {userOptions.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                  <div className="checkbox-grid">
                    {accessLevels.map((al) => (
                      <label key={al.id}>
                        <input
                          type="checkbox"
                          checked={editAccessIds.includes(al.id)}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...editAccessIds, al.id]
                              : editAccessIds.filter((id) => id !== al.id);
                            setEditAccessIds(next);
                          }}
                        />{" "}
                        {al.name}
                      </label>
                    ))}
                  </div>
                  <button className="btn alt" type="submit">
                    Salvar permissoes
                  </button>
                </form>
              </div>

              <div className="card" style={{ marginTop: 12 }}>
                <h3>Enviar planilha</h3>
                <form onSubmit={handleUpload} className="form-grid">
                  <input
                    className="field"
                    placeholder="Titulo"
                    value={uploadTitle}
                    onChange={(e) => setUploadTitle(e.target.value)}
                  />
                  <input className="field" type="file" onChange={(e) => setUploadFile(e.target.files?.[0] || null)} />
                  <div>
                    <strong>Acessos da planilha</strong>
                    <div className="checkbox-grid">
                      {accessLevels.map((al) => (
                        <label key={al.id}>
                          <input
                            type="checkbox"
                            checked={uploadAccessIds.includes(al.id)}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...uploadAccessIds, al.id]
                                : uploadAccessIds.filter((id) => id !== al.id);
                              setUploadAccessIds(next);
                            }}
                          />{" "}
                          {al.name}
                        </label>
                      ))}
                    </div>
                  </div>
                  <button className="btn" type="submit">
                    Enviar planilha
                  </button>
                </form>
              </div>

              <div className="card" style={{ marginTop: 12 }}>
                <h3>Usuarios</h3>
                <ul className="list">
                  {users.map((u) => (
                    <li className="item" key={u.id}>
                      <span>
                        {u.name} ({u.cnpj}) - UF: {u.uf || "-"} - {u.is_admin ? "Admin" : "Cliente"} -{" "}
                        {u.access_levels.map((a) => a.name).join(", ")}
                      </span>
                      <button className="btn danger" onClick={() => handleDeleteUser(u.id)}>
                        Excluir
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="card" style={{ marginTop: 12 }}>
                <h3>Planilhas cadastradas</h3>
                <ul className="list">
                  {adminSheets.map((s) => (
                    <li className="item" key={s.id}>
                      <span>
                        {s.title} - {s.access_levels.map((a) => a.name).join(", ")}
                      </span>
                      <button className="btn danger" onClick={() => handleDeleteSheet(s.id)}>
                        Excluir
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
        </div>

        <footer className="footer">
          <div className="footer-content">
            <div className="footer-top">
              <div className="footer-links">
                <h3>Links Úteis</h3>
                <a href="https://www.jacuzzi.com.br/contato-2/" target="_blank" rel="noreferrer">
                  <i className="fas fa-envelope" aria-hidden="true"></i> CONTATO
                </a>
                <a href="https://www.jacuzzi.com.br/assistencia-tecnica/" target="_blank" rel="noreferrer">
                  <i className="fas fa-tools" aria-hidden="true"></i> ASSISTÊNCIA TÉCNICA
                </a>
                <a href="https://www.jacuzzi.com.br/privacidade/" target="_blank" rel="noreferrer">
                  <i className="fas fa-shield-alt" aria-hidden="true"></i> POLÍTICA DE PRIVACIDADE
                </a>
              </div>

              <div className="footer-social">
                <h3>Redes Sociais</h3>
                <div className="social-icons">
                  <a
                    href="https://api.whatsapp.com/send/?phone=5511993769644&text&type=phone_number&app_absent=0"
                    target="_blank"
                    rel="noreferrer"
                    className="social-icon"
                    title="WhatsApp"
                  >
                    <i className="fab fa-whatsapp" aria-hidden="true"></i>
                  </a>
                  <a
                    href="https://www.facebook.com/jacuzzibrasil"
                    target="_blank"
                    rel="noreferrer"
                    className="social-icon"
                    title="Facebook"
                  >
                    <i className="fab fa-facebook-f" aria-hidden="true"></i>
                  </a>
                  <a
                    href="https://www.instagram.com/jacuzzibrasiloficial/"
                    target="_blank"
                    rel="noreferrer"
                    className="social-icon"
                    title="Instagram"
                  >
                    <i className="fab fa-instagram" aria-hidden="true"></i>
                  </a>
                  <a
                    href="https://www.youtube.com/channel/UCkk0U82tcl4hQ0DtVjy0dNw"
                    target="_blank"
                    rel="noreferrer"
                    className="social-icon"
                    title="YouTube"
                  >
                    <i className="fab fa-youtube" aria-hidden="true"></i>
                  </a>
                </div>
              </div>
            </div>

            <div className="footer-company-info">
              <p>
                <strong>JACUZZI DO BRASIL IND E COM LTDA</strong> - CNPJ 59.105.007/0001-10
              </p>
              <p>Rod. Waldomiro C. Camargo, km 53,5 - SP-79. CEP 13308-900 - Itu - SP</p>
              <p>Tel.: (11) 2118-7500 | Suporte tecnico: Grande Sao Paulo (11) 2118-7500</p>
              <p>Demais localidades - DDG 0800-702-1432 | E-mail: faleconosco@jacuzzi.com.br</p>
              <p className="footer-copy">© 2025 Jacuzzi do Brasil. Todos os direitos reservados.</p>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
