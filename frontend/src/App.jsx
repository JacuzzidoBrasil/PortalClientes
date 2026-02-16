import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import "./App.css";
import jacuzziLogo from "../Jacuzzi.png";
import deepDiveLogo from "../DeepDive.png";
import expressLogo from "../Express.png";
import grow2getherLogo from "../Grow2Gether.png";
import restoreYouLogo from "../RestoreYou.jpg";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
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

function getLogoKeysByAccess(accessLevels = []) {
  const levels = accessLevels.map((level) => String(level || "").toLowerCase());
  const keys = new Set();
  if (levels.some((level) => level.includes("deep dive"))) keys.add("deepdive");
  if (levels.some((level) => level.includes("express"))) keys.add("express");
  if (levels.some((level) => level.includes("grow2gether"))) keys.add("grow2gether");
  if (levels.some((level) => level.includes("restore you"))) keys.add("restoreyou");
  return Array.from(keys);
}

export default function App() {
  const [cnpj, setCnpj] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(localStorage.getItem("token"));
  const [me, setMe] = useState(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("error");

  const [showFirstAccess, setShowFirstAccess] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [firstAccessForm, setFirstAccessForm] = useState({
    cnpj: "",
    email: "",
    code: "",
    new_password: "",
  });
  const [resetForm, setResetForm] = useState({
    cnpj: "",
    email: "",
    code: "",
    new_password: "",
  });

  const [spreadsheets, setSpreadsheets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [table, setTable] = useState({ columns: [], rows: [] });
  const [search, setSearch] = useState("");
  const [searchCol, setSearchCol] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 100;

  const [accessLevels, setAccessLevels] = useState([]);
  const [users, setUsers] = useState([]);
  const [adminSheets, setAdminSheets] = useState([]);

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

  function setError(msg) {
    setMessageTone("error");
    setMessage(msg);
  }

  function setSuccess(msg) {
    setMessageTone("ok");
    setMessage(msg);
  }

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
      setError("Login invalido.");
    }
  }

  function handleLogout() {
    setToken(null);
    setMe(null);
    localStorage.removeItem("token");
  }

  async function loadSpreadsheets() {
    try {
      const res = await axios.get(`${API_URL}/spreadsheets`, authHeaders(token));
      setSpreadsheets(res.data);
    } catch {
      setError("Erro ao carregar planilhas.");
    }
  }

  async function loadData(id, reset = false) {
    const nextOffset = reset ? 0 : offset;
    setSelectedId(id);
    const params = {
      limit,
      offset: nextOffset,
    };
    if (search) params.search = search;
    if (searchCol) params.col = searchCol;
    try {
      const res = await axios.get(`${API_URL}/spreadsheets/${id}/data`, {
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
      const res = await axios.get(`${API_URL}/spreadsheets/${id}/download?format=${format}`, {
        ...authHeaders(token),
        responseType: "blob",
      });
      const blob = new Blob([res.data]);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = format === "csv" ? "planilha.csv" : "planilha.xlsx";
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
    try {
      await axios.post(`${API_URL}/admin/users`, newUser, authHeaders(token));
      setNewUser({ cnpj: "", name: "", email: "", uf: "", password: "", is_admin: false, access_level_ids: [] });
      await loadAdminData();
      setSuccess("Usuario criado.");
    } catch {
      setError("Erro ao criar usuario.");
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

  async function requestFirstAccessCode() {
    setMessage("");
    try {
      await axios.post(`${API_URL}/auth/first-access/request`, {
        cnpj: firstAccessForm.cnpj,
        email: firstAccessForm.email,
      });
      setSuccess("Codigo de primeiro acesso enviado por email.");
    } catch {
      setError("Erro ao solicitar primeiro acesso.");
    }
  }

  async function confirmFirstAccess() {
    setMessage("");
    try {
      await axios.post(`${API_URL}/auth/first-access/confirm`, firstAccessForm);
      setSuccess("Senha definida. Voce ja pode fazer login.");
      setShowFirstAccess(false);
    } catch {
      setError("Erro ao confirmar primeiro acesso.");
    }
  }

  async function requestResetCode() {
    setMessage("");
    try {
      await axios.post(`${API_URL}/auth/password-reset/request`, {
        cnpj: resetForm.cnpj,
        email: resetForm.email,
      });
      setSuccess("Codigo de recuperacao enviado por email.");
    } catch {
      setError("Erro ao solicitar recuperacao.");
    }
  }

  async function confirmReset() {
    setMessage("");
    try {
      await axios.post(`${API_URL}/auth/password-reset/confirm`, resetForm);
      setSuccess("Senha atualizada. Voce ja pode fazer login.");
      setShowReset(false);
    } catch {
      setError("Erro ao confirmar recuperacao.");
    }
  }

  const userOptions = useMemo(() => users.map((u) => ({ id: u.id, label: `${u.name} (${u.cnpj})` })), [users]);
  const visibleLogoKeys = useMemo(() => {
    if (!me) return [];
    if (me.is_admin) return ["deepdive", "express", "grow2gether", "restoreyou"];
    return getLogoKeysByAccess(me.access_levels || []);
  }, [me]);

  const logoMap = {
    deepdive: { src: deepDiveLogo, alt: "Deep Dive" },
    express: { src: expressLogo, alt: "Express" },
    grow2gether: { src: grow2getherLogo, alt: "Grow2Gether" },
    restoreyou: { src: restoreYouLogo, alt: "Restore You" },
  };

  if (!token) {
    return (
      <div className="page">
        <div className="login-wrap">
          <section className="login-card">
            <div className="login-side">
              <img src={jacuzziLogo} alt="Jacuzzi" className="login-jacuzzi" />
              <h1>Portal Clientes Jacuzzi</h1>
              <h2 className="panel-title">Entrar</h2>
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
                <button className="btn login-enter" type="submit">
                  Entrar
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
                  <button className="btn alt" type="button" onClick={requestFirstAccessCode}>
                    Enviar codigo
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
                  <button className="btn" type="button" onClick={confirmFirstAccess}>
                    Confirmar primeiro acesso
                  </button>
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
                  <button className="btn alt" type="button" onClick={requestResetCode}>
                    Enviar codigo
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
                  <button className="btn" type="button" onClick={confirmReset}>
                    Confirmar recuperacao
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
      <div className="app-shell">
        <header className="topbar">
          <div className="topbar-left">
            <div className="topbar-main">
              <div>
                <h1 className="title">Portal Clientes</h1>
                <div className="welcome-row">
                  <p className="subtitle">{me ? `Bem-vindo, ${me.name}` : "Painel de acesso"}</p>
                </div>
              </div>
              <div className="access-logo-row">
                {visibleLogoKeys.map((key) => (
                  <img key={key} src={logoMap[key].src} alt={logoMap[key].alt} className="access-logo" />
                ))}
                <img src={jacuzziLogo} alt="Jacuzzi" className="jacuzzi-banner" />
              </div>
            </div>
            <div className="row top-load-actions">
              <button className="btn load-sheets" onClick={loadSpreadsheets}>
                Carregar planilhas
              </button>
              {me?.is_admin && (
                <button className="btn load-admin" onClick={loadAdminData}>
                  Carregar dados admin
                </button>
              )}
            </div>
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
            <div className="row">
              <input
                className="field"
                placeholder="Buscar na tabela"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <input
                className="field"
                placeholder="Coluna opcional"
                value={searchCol}
                onChange={(e) => setSearchCol(e.target.value)}
              />
              <button className="btn alt" onClick={() => selectedId && loadData(selectedId, true)}>
                Buscar
              </button>
            </div>

            <ul className="list">
              {spreadsheets.map((it) => (
                <li className="item" key={it.id}>
                  <strong>{it.title}</strong>
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
          </section>

          {me?.is_admin && (
            <section className="card">
              <h2>Administracao</h2>
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
                  <button className="btn" type="submit">
                    Criar usuario
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
      </div>
    </div>
  );
}
