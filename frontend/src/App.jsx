import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

function authHeaders(token) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

const palette = {
  bg: "linear-gradient(135deg, #0c1a2b 0%, #0f2d52 40%, #0a1c33 100%)",
  card: "#0f2138",
  cardSoft: "#132a45",
  accent: "#ffb347",
  accent2: "#4ad7d1",
  text: "#eaf2ff",
  subtle: "#8fb0d7",
  danger: "#ff6b6b",
};

const pill = {
  padding: "6px 12px",
  borderRadius: 999,
  border: "1px solid #27446a",
  background: "#0c1a2b",
  color: palette.subtle,
  fontSize: 12,
};

export default function App() {
  const [cnpj, setCnpj] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(localStorage.getItem("token"));
  const [me, setMe] = useState(null);
  const [message, setMessage] = useState("");

  const [spreadsheets, setSpreadsheets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [table, setTable] = useState({ columns: [], rows: [] });
  const [search, setSearch] = useState("");
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
    const res = await axios.get(
      `${API_URL}/spreadsheets/${id}/data?limit=${limit}&offset=${nextOffset}&search=${encodeURIComponent(search)}`,
      authHeaders(token)
    );
    setTable(res.data);
    if (reset) setOffset(0);
  }

  function nextPage() {
    const next = offset + limit;
    setOffset(next);
    if (selectedId) loadData(selectedId);
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

  const layout = {
    page: {
      minHeight: "100vh",
      background: palette.bg,
      color: palette.text,
      fontFamily: "'Space Grotesk', 'Inter', system-ui, sans-serif",
      padding: "32px 20px 60px",
    },
    shell: { maxWidth: 1200, margin: "0 auto", display: "grid", gap: 24 },
    card: { background: palette.card, border: "1px solid #1d3557", borderRadius: 16, padding: 20, boxShadow: "0 10px 40px rgba(0,0,0,0.25)" },
    button: {
      background: palette.accent,
      color: "#0c1a2b",
      border: "none",
      padding: "10px 16px",
      borderRadius: 10,
      cursor: "pointer",
      fontWeight: 700,
      boxShadow: "0 6px 20px rgba(255,179,71,0.25)",
    },
    ghost: {
      background: "transparent",
      color: palette.text,
      border: "1px solid #1d3557",
      padding: "10px 16px",
      borderRadius: 10,
      cursor: "pointer",
    },
    input: {
      background: palette.cardSoft,
      border: "1px solid #1d3557",
      color: palette.text,
      padding: "10px 12px",
      borderRadius: 10,
      width: "100%",
    },
    gridColumns: { display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" },
  };

  if (!token) {
    return (
      <div style={layout.page}>
        <div style={layout.shell}>
          <section style={{ ...layout.card, display: "grid", gap: 16, textAlign: "center" }}>
            <img src="/brand.png" alt="Deep Dive / Restore You" style={{ width: 220, justifySelf: "center", borderRadius: 12 }} />
            <h1 style={{ margin: 0 }}>Portal Clientes</h1>
            <p style={{ color: palette.subtle }}>
              Acesse planilhas exclusivas por categoria e gerencie seu cat?logo em um s? lugar.
            </p>
            <form onSubmit={handleLogin} style={{ display: "grid", gap: 12, maxWidth: 360, justifySelf: "center", width: "100%" }}>
              <input style={layout.input} placeholder="CNPJ" value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
              <input style={layout.input} placeholder="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <button style={layout.button} type="submit">Entrar</button>
              {message && <div style={{ color: palette.danger }}>{message}</div>}
            </form>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div style={layout.page}>
      <div style={layout.shell}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <img src="/brand.png" alt="logo" style={{ width: 80, borderRadius: 12, background: "#0c1a2b" }} />
            <div>
              <div style={{ ...pill, display: "inline-block" }}>Cat?logos exclusivos</div>
              <h1 style={{ margin: "4px 0 0" }}>Portal Clientes</h1>
              {me && <div style={{ color: palette.subtle }}>Bem-vindo, {me.name}</div>}
            </div>
          </div>
          <button style={layout.ghost} onClick={handleLogout}>Sair</button>
        </header>

        {message && <div style={{ color: palette.accent }}>{message}</div>}

        <section style={layout.card}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>Planilhas</h2>
            <button style={layout.button} onClick={loadSpreadsheets}>Carregar</button>
            <input
              style={{ ...layout.input, maxWidth: 280 }}
              placeholder="Buscar nas colunas..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button style={layout.ghost} onClick={() => selectedId && loadData(selectedId, true)}>Buscar</button>
          </div>

          <div style={layout.gridColumns}>
            {spreadsheets.map((it) => (
              <div key={it.id} style={{ ...layout.card, padding: 14, background: "#112840" }}>
                <div style={{ fontWeight: 700 }}>{it.title}</div>
                <button style={{ ...layout.button, marginTop: 10 }} onClick={() => loadData(it.id, true)}>Visualizar</button>
              </div>
            ))}
          </div>

          {selectedId && (
            <div style={{ marginTop: 20 }}>
              <h3>Dados</h3>
              <div style={{ overflow: "auto", borderRadius: 12, border: "1px solid #1d3557" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead style={{ background: "#10263f" }}>
                    <tr>
                      {table.columns.map((c) => (
                        <th key={c} style={{ padding: 8, borderBottom: "1px solid #1d3557", textAlign: "left" }}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((row, idx) => (
                      <tr key={idx} style={{ background: idx % 2 === 0 ? "#0f2138" : "#0c1a2b" }}>
                        {table.columns.map((c) => (
                          <td key={c} style={{ padding: 8, borderBottom: "1px solid #1d3557" }}>{row[c]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button style={{ ...layout.ghost, marginTop: 10 }} onClick={nextPage}>Pr?xima p?gina</button>
            </div>
          )}
        </section>

        {me?.is_admin && (
          <section style={{ ...layout.card, display: "grid", gap: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0 }}>Administra??o</h2>
              <button style={layout.button} onClick={loadAdminData}>Atualizar dados</button>
            </div>

            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
              <form onSubmit={handleCreateUser} style={{ ...layout.card, padding: 14, background: palette.cardSoft }}>
                <h3 style={{ marginTop: 0 }}>Criar Usu?rio</h3>
                <input style={layout.input} placeholder="CNPJ" value={newUser.cnpj} onChange={(e) => setNewUser({ ...newUser, cnpj: e.target.value })} />
                <input style={layout.input} placeholder="Nome" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} />
                <input style={layout.input} placeholder="Email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} />
                <input style={layout.input} placeholder="Senha" type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="checkbox" checked={newUser.is_admin} onChange={(e) => setNewUser({ ...newUser, is_admin: e.target.checked })} />
                  Admin
                </label>
                <div>
                  <strong>Acessos</strong>
                  <div style={{ ...layout.gridColumns, marginTop: 6 }}>
                    {accessLevels.map((al) => (
                      <label key={al.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
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
                <button style={{ ...layout.button, marginTop: 10 }} type="submit">Criar</button>
              </form>

              <form onSubmit={handleUpdateUserAccess} style={{ ...layout.card, padding: 14, background: palette.cardSoft }}>
                <h3 style={{ marginTop: 0 }}>Atualizar Permiss?es</h3>
                <select style={layout.input} value={editUserId} onChange={(e) => setEditUserId(e.target.value)}>
                  <option value="">Selecione um usu?rio</option>
                  {userOptions.map((u) => (
                    <option key={u.id} value={u.id}>{u.label}</option>
                  ))}
                </select>
                <div style={{ ...layout.gridColumns, marginTop: 6 }}>
                  {accessLevels.map((al) => (
                    <label key={al.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
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
                <button style={{ ...layout.button, marginTop: 10 }} type="submit">Salvar</button>
              </form>

              <form onSubmit={handleUpload} style={{ ...layout.card, padding: 14, background: palette.cardSoft }}>
                <h3 style={{ marginTop: 0 }}>Enviar Planilha</h3>
                <input style={layout.input} placeholder="T?tulo" value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} />
                <input style={layout.input} type="file" onChange={(e) => setUploadFile(e.target.files?.[0] || null)} />
                <div>
                  <strong>Acessos</strong>
                  <div style={{ ...layout.gridColumns, marginTop: 6 }}>
                    {accessLevels.map((al) => (
                      <label key={al.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
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
                <button style={{ ...layout.button, marginTop: 10 }} type="submit">Enviar</button>
              </form>
            </div>

            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
              <div style={{ ...layout.card, background: palette.cardSoft }}>
                <h3 style={{ marginTop: 0 }}>Usu?rios</h3>
                <div style={{ display: "grid", gap: 8 }}>
                  {users.map((u) => (
                    <div key={u.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#10263f", padding: 10, borderRadius: 10 }}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{u.name} ({u.cnpj})</div>
                        <div style={{ color: palette.subtle, fontSize: 12 }}>
                          {u.is_admin ? "Admin" : "Cliente"} ? {u.access_levels.map((a) => a.name).join(", ") || "Sem n?veis"}
                        </div>
                      </div>
                      <button style={{ ...layout.ghost, borderColor: palette.danger, color: palette.danger }} onClick={() => handleDeleteUser(u.id)}>Excluir</button>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ ...layout.card, background: palette.cardSoft }}>
                <h3 style={{ marginTop: 0 }}>Planilhas</h3>
                <div style={{ display: "grid", gap: 8 }}>
                  {adminSheets.map((s) => (
                    <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#10263f", padding: 10, borderRadius: 10 }}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{s.title}</div>
                        <div style={{ color: palette.subtle, fontSize: 12 }}>
                          {s.access_levels.map((a) => a.name).join(", ") || "Sem n?veis"}
                        </div>
                      </div>
                      <button style={{ ...layout.ghost, borderColor: palette.danger, color: palette.danger }} onClick={() => handleDeleteSheet(s.id)}>Excluir</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
