import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

function authHeaders(token) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

export default function App() {
  const [cnpj, setCnpj] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(localStorage.getItem("token"));
  const [me, setMe] = useState(null);
  const [message, setMessage] = useState("");
  const [showFirstAccess, setShowFirstAccess] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [firstAccessForm, setFirstAccessForm] = useState({ cnpj: "", email: "", code: "", new_password: "" });
  const [resetForm, setResetForm] = useState({ cnpj: "", email: "", code: "", new_password: "" });

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

  async function loadMe() {
    try {
      const res = await axios.get(`${API_URL}/auth/me`, authHeaders(token));
      setMe(res.data);
    } catch (err) {
      setMessage("Sess?o expirada. Fa?a login novamente.");
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
        setMessage("Primeiro acesso necess?rio. Use o fluxo de primeiro acesso.");
        setShowFirstAccess(true);
        setShowReset(false);
        setFirstAccessForm({ ...firstAccessForm, cnpj, email: "" });
        return;
      }
      setMessage("Login inv?lido.");
    }
  }

  function handleLogout() {
    setToken(null);
    setMe(null);
    localStorage.removeItem("token");
  }

  async function loadSpreadsheets() {
    const res = await axios.get(`${API_URL}/spreadsheets`, authHeaders(token));
    setSpreadsheets(res.data);
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
    } catch (err) {
      setMessage("Erro ao carregar dados da planilha.");
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
    } catch (err) {
      setMessage("Erro ao baixar planilha.");
    }
  }

  async function loadAdminData() {
    const [levelsRes, usersRes, sheetsRes] = await Promise.all([
      axios.get(`${API_URL}/admin/access-levels`, authHeaders(token)),
      axios.get(`${API_URL}/admin/users`, authHeaders(token)),
      axios.get(`${API_URL}/admin/spreadsheets`, authHeaders(token)),
    ]);
    setAccessLevels(levelsRes.data);
    setUsers(usersRes.data);
    setAdminSheets(sheetsRes.data);
  }

  async function handleCreateUser(e) {
    e.preventDefault();
    setMessage("");
    try {
      await axios.post(`${API_URL}/admin/users`, newUser, authHeaders(token));
      setNewUser({ cnpj: "", name: "", email: "", password: "", is_admin: false, access_level_ids: [] });
      await loadAdminData();
      setMessage("Usu?rio criado.");
    } catch (err) {
      setMessage("Erro ao criar usu?rio.");
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
      setMessage("Permiss?es atualizadas.");
    } catch (err) {
      setMessage("Erro ao atualizar permiss?es.");
    }
  }

  async function handleDeleteUser(id) {
    if (!window.confirm("Excluir este usu?rio?")) return;
    try {
      await axios.delete(`${API_URL}/admin/users/${id}`, authHeaders(token));
      await loadAdminData();
      setMessage("Usu?rio exclu?do.");
    } catch (err) {
      setMessage("Erro ao excluir usu?rio.");
    }
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (!uploadFile) {
      setMessage("Selecione uma planilha.");
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
      setMessage("Planilha enviada.");
    } catch (err) {
      setMessage("Erro ao enviar planilha.");
    }
  }

  async function handleDeleteSheet(id) {
    if (!window.confirm("Excluir esta planilha?")) return;
    try {
      await axios.delete(`${API_URL}/admin/spreadsheets/${id}`, authHeaders(token));
      await loadAdminData();
      setMessage("Planilha exclu?da.");
    } catch (err) {
      setMessage("Erro ao excluir planilha.");
    }
  }

  const userOptions = useMemo(() => users.map((u) => ({ id: u.id, label: `${u.name} (${u.cnpj})` })), [users]);

  if (!token) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Portal Clientes</h1>
        <form onSubmit={handleLogin} style={{ display: "grid", gap: 8, maxWidth: 320 }}>
          <input placeholder="CNPJ" value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
          <input placeholder="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="submit">Entrar</button>
          {message && <div style={{ color: "crimson" }}>{message}</div>}
        </form>

        <div style={{ marginTop: 12, display: "flex", gap: 12 }}>
          <button onClick={() => { setShowFirstAccess(!showFirstAccess); setShowReset(false); }}>
            Primeiro acesso
          </button>
          <button onClick={() => { setShowReset(!showReset); setShowFirstAccess(false); }}>
            Recuperar senha
          </button>
        </div>

        {showFirstAccess && (
          <div style={{ marginTop: 16, maxWidth: 360, display: "grid", gap: 8 }}>
            <strong>Primeiro acesso</strong>
            <input
              placeholder="CNPJ"
              value={firstAccessForm.cnpj}
              onChange={(e) => setFirstAccessForm({ ...firstAccessForm, cnpj: e.target.value })}
            />
            <input
              placeholder="Email"
              value={firstAccessForm.email}
              onChange={(e) => setFirstAccessForm({ ...firstAccessForm, email: e.target.value })}
            />
            <button
              onClick={async () => {
                setMessage("");
                try {
                  await axios.post(`${API_URL}/auth/first-access/request`, {
                    cnpj: firstAccessForm.cnpj,
                    email: firstAccessForm.email,
                  });
                  setMessage("C?digo de primeiro acesso enviado por email.");
                } catch (err) {
                  setMessage("Erro ao solicitar primeiro acesso.");
                }
              }}
            >
              Enviar c?digo
            </button>
            <input
              placeholder="C?digo recebido"
              value={firstAccessForm.code}
              onChange={(e) => setFirstAccessForm({ ...firstAccessForm, code: e.target.value })}
            />
            <input
              placeholder="Nova senha"
              type="password"
              value={firstAccessForm.new_password}
              onChange={(e) => setFirstAccessForm({ ...firstAccessForm, new_password: e.target.value })}
            />
            <button
              onClick={async () => {
                setMessage("");
                try {
                  await axios.post(`${API_URL}/auth/first-access/confirm`, firstAccessForm);
                  setMessage("Senha definida. Voc? j? pode fazer login.");
                  setShowFirstAccess(false);
                } catch (err) {
                  setMessage("Erro ao confirmar primeiro acesso.");
                }
              }}
            >
              Confirmar primeiro acesso
            </button>
          </div>
        )}

        {showReset && (
          <div style={{ marginTop: 16, maxWidth: 360, display: "grid", gap: 8 }}>
            <strong>Recuperar senha</strong>
            <input
              placeholder="CNPJ"
              value={resetForm.cnpj}
              onChange={(e) => setResetForm({ ...resetForm, cnpj: e.target.value })}
            />
            <input
              placeholder="Email"
              value={resetForm.email}
              onChange={(e) => setResetForm({ ...resetForm, email: e.target.value })}
            />
            <button
              onClick={async () => {
                setMessage("");
                try {
                  await axios.post(`${API_URL}/auth/password-reset/request`, {
                    cnpj: resetForm.cnpj,
                    email: resetForm.email,
                  });
                  setMessage("C?digo de recupera??o enviado por email.");
                } catch (err) {
                  setMessage("Erro ao solicitar recupera??o.");
                }
              }}
            >
              Enviar c?digo
            </button>
            <input
              placeholder="C?digo recebido"
              value={resetForm.code}
              onChange={(e) => setResetForm({ ...resetForm, code: e.target.value })}
            />
            <input
              placeholder="Nova senha"
              type="password"
              value={resetForm.new_password}
              onChange={(e) => setResetForm({ ...resetForm, new_password: e.target.value })}
            />
            <button
              onClick={async () => {
                setMessage("");
                try {
                  await axios.post(`${API_URL}/auth/password-reset/confirm`, resetForm);
                  setMessage("Senha atualizada. Voc? j? pode fazer login.");
                  setShowReset(false);
                } catch (err) {
                  setMessage("Erro ao confirmar recupera??o.");
                }
              }}
            >
              Confirmar recupera??o
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: 24, display: "grid", gap: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0 }}>Portal Clientes</h1>
          {me && <div>Bem-vindo, {me.name}</div>}
        </div>
        <button onClick={handleLogout}>Sair</button>
      </header>

      {message && <div style={{ color: "#0a6" }}>{message}</div>}

      <section style={{ border: "1px solid #ddd", padding: 16 }}>
        <h2>Planilhas</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={loadSpreadsheets}>Carregar Planilhas</button>
          <input
            placeholder="Buscar na tabela..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
          <input
            placeholder="Coluna (opcional)"
            value={searchCol}
            onChange={(e) => setSearchCol(e.target.value)}
            style={{ width: 180 }}
          />
          <button onClick={() => selectedId && loadData(selectedId, true)}>Buscar</button>
        </div>
        <ul>
          {spreadsheets.map((it) => (
            <li key={it.id}>
              <button onClick={() => loadData(it.id, true)}>{it.title}</button>
              <button style={{ marginLeft: 8 }} onClick={() => downloadSheet(it.id, "excel")}>
                Baixar Excel
              </button>
              <button style={{ marginLeft: 4 }} onClick={() => downloadSheet(it.id, "csv")}>
                Baixar CSV
              </button>
            </li>
          ))}
        </ul>

        {selectedId && (
          <div>
            <h3>Dados</h3>
            <table border="1" cellPadding="6">
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
            <button onClick={nextPage} style={{ marginTop: 8 }}>
              Pr?xima p?gina
            </button>
          </div>
        )}
      </section>

      {me?.is_admin && (
        <section style={{ border: "1px solid #ddd", padding: 16 }}>
          <h2>Administra??o</h2>
          <button onClick={loadAdminData}>Carregar Dados Admin</button>

          <div style={{ display: "grid", gap: 16, marginTop: 16 }}>
            <form onSubmit={handleCreateUser} style={{ border: "1px solid #eee", padding: 12 }}>
              <h3>Criar Usu?rio</h3>
              <input placeholder="CNPJ" value={newUser.cnpj} onChange={(e) => setNewUser({ ...newUser, cnpj: e.target.value })} />
              <input placeholder="Nome" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} />
              <input placeholder="Email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} />
              <input placeholder="Senha" type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
              <label>
                <input type="checkbox" checked={newUser.is_admin} onChange={(e) => setNewUser({ ...newUser, is_admin: e.target.checked })} />
                Admin
              </label>
              <div>
                <strong>Acessos</strong>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 4 }}>
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
                      />
                      {al.name}
                    </label>
                  ))}
                </div>
              </div>
              <button type="submit">Criar</button>
            </form>

            <form onSubmit={handleUpdateUserAccess} style={{ border: "1px solid #eee", padding: 12 }}>
              <h3>Atualizar Permiss?es</h3>
              <select value={editUserId} onChange={(e) => setEditUserId(e.target.value)}>
                <option value="">Selecione um usu?rio</option>
                {userOptions.map((u) => (
                  <option key={u.id} value={u.id}>{u.label}</option>
                ))}
              </select>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 4, marginTop: 8 }}>
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
                    />
                    {al.name}
                  </label>
                ))}
              </div>
              <button type="submit">Salvar Permiss?es</button>
            </form>

            <form onSubmit={handleUpload} style={{ border: "1px solid #eee", padding: 12 }}>
              <h3>Enviar Planilha</h3>
              <input placeholder="T?tulo" value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} />
              <input type="file" onChange={(e) => setUploadFile(e.target.files?.[0] || null)} />
              <div>
                <strong>Acessos</strong>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 4 }}>
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
                      />
                      {al.name}
                    </label>
                  ))}
                </div>
              </div>
              <button type="submit">Enviar</button>
            </form>

            <div style={{ border: "1px solid #eee", padding: 12 }}>
              <h3>Usu?rios</h3>
              <ul>
                {users.map((u) => (
                  <li key={u.id}>
                    {u.name} ({u.cnpj}) - {u.is_admin ? "Admin" : "Cliente"} - {u.access_levels.map((a) => a.name).join(", ")}
                    <button style={{ marginLeft: 8 }} onClick={() => handleDeleteUser(u.id)}>Excluir</button>
                  </li>
                ))}
              </ul>
            </div>

            <div style={{ border: "1px solid #eee", padding: 12 }}>
              <h3>Planilhas</h3>
              <ul>
                {adminSheets.map((s) => (
                  <li key={s.id}>
                    {s.title} - {s.access_levels.map((a) => a.name).join(", ")}
                    <button style={{ marginLeft: 8 }} onClick={() => handleDeleteSheet(s.id)}>Excluir</button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
