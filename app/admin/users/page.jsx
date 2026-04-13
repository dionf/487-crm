"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import AppShell from "@/components/AppShell";
import { useOrg } from "@/lib/org-context";
import { apiFetch } from "@/lib/api";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil, X, Save, Shield, User, ArrowLeft } from "lucide-react";

export default function UserManagementPage() {
  const { isAdmin, organization } = useOrg();
  const router = useRouter();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", pin: "", role: "agent" });
  const [error, setError] = useState("");

  useEffect(() => {
    fetchUsers();
  }, []);

  async function fetchUsers() {
    const res = await apiFetch("/api/admin/users");
    const data = await res.json();
    setUsers(data.users || []);
    setLoading(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!form.name || !form.email || (!editingId && !form.pin)) {
      setError("Naam, email en pin zijn verplicht");
      return;
    }

    const url = editingId ? `/api/admin/users/${editingId}` : "/api/admin/users";
    const method = editingId ? "PATCH" : "POST";

    const body = { ...form };
    if (editingId && !body.pin) delete body.pin; // Don't update pin if empty

    const res = await apiFetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Fout bij opslaan");
      return;
    }

    setShowForm(false);
    setEditingId(null);
    setForm({ name: "", email: "", phone: "", pin: "", role: "agent" });
    fetchUsers();
  }

  async function deleteUser(id) {
    if (!confirm("Weet je zeker dat je deze gebruiker wilt verwijderen?")) return;
    await apiFetch(`/api/admin/users/${id}`, { method: "DELETE" });
    fetchUsers();
  }

  function startEdit(user) {
    setForm({ name: user.name, email: user.email, phone: user.phone || "", pin: "", role: user.role });
    setEditingId(user.id);
    setShowForm(true);
  }

  const accentColor = organization?.theme?.accent || "#F5A623";

  return (
    <AppShell>
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-black mb-4 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Terug
      </button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-brand-black">Gebruikers</h1>
          <p className="text-sm text-gray-500 mt-0.5">{organization?.display_name}</p>
        </div>
        <button
          onClick={() => {
            setForm({ name: "", email: "", pin: "", role: "agent" });
            setEditingId(null);
            setShowForm(true);
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-pill text-sm font-semibold text-white transition-colors"
          style={{ backgroundColor: accentColor }}
        >
          <Plus className="w-4 h-4" />
          Gebruiker toevoegen
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-brand-amber border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Naam</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Email</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Rol</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Status</th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase px-4 py-3">Acties</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold"
                        style={{ backgroundColor: accentColor }}
                      >
                        {u.name.charAt(0)}
                      </div>
                      <span className="text-sm font-medium">{u.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-pill ${
                      u.role === "admin" ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-600"
                    }`}>
                      {u.role === "admin" ? "Admin" : "Agent"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-pill ${
                      u.is_active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
                    }`}>
                      {u.is_active ? "Actief" : "Inactief"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => startEdit(u)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-brand-orange hover:bg-amber-50"
                        title="Bewerken"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => deleteUser(u.id)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50"
                        title="Verwijderen"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* User form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-lg">
                {editingId ? "Gebruiker bewerken" : "Nieuwe gebruiker"}
              </h2>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {error && (
                <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-xl">{error}</div>
              )}
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase">Naam *</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase">Email *</label>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase">Telefoon</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                  placeholder="+31 6..."
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase">
                  Pincode {editingId ? "(laat leeg om niet te wijzigen)" : "*"}
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  required={!editingId}
                  value={form.pin}
                  onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "") })}
                  className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                  placeholder="4-6 cijfers"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase">Rol</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber bg-white"
                >
                  <option value="agent">Agent</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 py-2.5 border border-gray-200 rounded-pill text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  Annuleren
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-pill text-sm font-semibold text-white"
                  style={{ backgroundColor: accentColor }}
                >
                  {editingId ? "Opslaan" : "Toevoegen"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
