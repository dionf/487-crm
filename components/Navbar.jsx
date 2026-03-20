"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  LogOut,
  Search,
  ListTodo,
  Bell,
  Calendar,
  X,
  AlertCircle,
  CheckCircle,
} from "lucide-react";
import { cn, formatRelativeTime, formatDateTime } from "@/lib/utils";
import UserSelector from "./UserSelector";
import StatusBadge from "./StatusBadge";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
];

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(null);

  // Todo panel state
  const [todosOpen, setTodosOpen] = useState(false);
  const [todos, setTodos] = useState([]);
  const [todoLoading, setTodoLoading] = useState(false);
  const todoRef = useRef(null);

  // Follow-up tasks (notifications)
  const [notifOpen, setNotifOpen] = useState(false);
  const [followUps, setFollowUps] = useState([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const notifRef = useRef(null);

  function getCurrentUser() {
    if (typeof window !== "undefined") {
      return localStorage.getItem("crm-user") || "Dion";
    }
    return "Dion";
  }

  // Load todo count and follow-ups on mount
  useEffect(() => {
    fetchTodos();
    fetchFollowUps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Search debounce
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      setSearchResults(data.results);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch todos
  async function fetchTodos() {
    setTodoLoading(true);
    const user = getCurrentUser();
    const res = await fetch(`/api/todos?user=${encodeURIComponent(user)}`);
    const data = await res.json();
    setTodos(data.todos || []);
    setTodoLoading(false);
  }

  // Fetch follow-up tasks
  async function fetchFollowUps() {
    setNotifLoading(true);
    try {
      const res = await fetch("/api/follow-ups");
      const data = await res.json();
      setFollowUps(data.tasks || []);
    } catch {}
    setNotifLoading(false);
  }

  function toggleTodos() {
    if (!todosOpen) fetchTodos();
    setTodosOpen(!todosOpen);
  }

  function toggleNotifs() {
    if (!notifOpen) fetchFollowUps();
    setNotifOpen(!notifOpen);
  }

  async function completeFollowUp(taskId) {
    await fetch(`/api/follow-ups/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_completed: true }),
    });
    fetchFollowUps();
  }

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSearchOpen(false);
      }
      if (todoRef.current && !todoRef.current.contains(e.target)) {
        setTodosOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleLogout() {
    localStorage.removeItem("crm-auth");
    window.location.reload();
  }

  const hasOverdue = todos.some(
    (t) => t.due_date && new Date(t.due_date) < new Date()
  );

  return (
    <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-brand-black rounded-lg flex items-center justify-center">
              <span className="text-brand-amber font-bold text-sm">48</span>
            </div>
            <span className="font-bold text-brand-black">-7 CRM</span>
          </Link>

          {/* Nav links */}
          <div className="flex items-center gap-1">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors",
                    isActive
                      ? "bg-brand-amber/10 text-brand-orange"
                      : "text-brand-dark-gray hover:bg-gray-100"
                  )}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>

          {/* Search */}
          <div ref={searchRef} className="relative">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                placeholder="Zoek leads, notities..."
                className="w-64 pl-9 pr-8 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber bg-gray-50 focus:bg-white transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(""); setSearchResults(null); }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Search results dropdown */}
            {searchOpen && searchResults && (
              <div className="absolute top-full mt-2 w-80 bg-white rounded-2xl shadow-lg border border-gray-100 py-2 max-h-96 overflow-y-auto">
                {searchResults.leads?.length > 0 && (
                  <div>
                    <p className="px-3 py-1 text-[10px] font-bold uppercase text-gray-400 tracking-wide">Leads</p>
                    {searchResults.leads.map((lead) => (
                      <button
                        key={lead.id}
                        onClick={() => {
                          router.push(`/leads/${lead.id}`);
                          setSearchOpen(false);
                          setSearchQuery("");
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between"
                      >
                        <div>
                          <p className="text-sm font-medium">{lead.company_name}</p>
                          <p className="text-xs text-gray-500">{lead.contact_person}</p>
                        </div>
                        <StatusBadge status={lead.status} size="sm" />
                      </button>
                    ))}
                  </div>
                )}
                {searchResults.notes?.length > 0 && (
                  <div>
                    <p className="px-3 py-1 text-[10px] font-bold uppercase text-gray-400 tracking-wide mt-1">Notities</p>
                    {searchResults.notes.map((note) => (
                      <button
                        key={note.id}
                        onClick={() => {
                          router.push(`/leads/${note.lead_id}`);
                          setSearchOpen(false);
                          setSearchQuery("");
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50"
                      >
                        <p className="text-sm truncate">{note.content}</p>
                        <p className="text-xs text-gray-400">{note.leads?.company_name}</p>
                      </button>
                    ))}
                  </div>
                )}
                {searchResults.leads?.length === 0 && searchResults.notes?.length === 0 && (
                  <p className="px-3 py-4 text-sm text-gray-400 text-center">Geen resultaten</p>
                )}
              </div>
            )}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {/* Notifications bell */}
            <div ref={notifRef} className="relative">
              <button
                onClick={toggleNotifs}
                className={cn(
                  "relative p-2 rounded-xl transition-colors",
                  notifOpen
                    ? "bg-brand-amber/10 text-brand-orange"
                    : "text-gray-400 hover:text-brand-dark-gray hover:bg-gray-100"
                )}
                title="Notificaties"
              >
                <Bell className="w-4 h-4" />
                {followUps.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center text-white bg-red-500">
                    {followUps.length}
                  </span>
                )}
              </button>

              {/* Notifications dropdown */}
              {notifOpen && (
                <div className="absolute right-0 top-full mt-2 w-96 bg-white rounded-2xl shadow-lg border border-gray-100 py-2 max-h-[28rem] overflow-y-auto">
                  <div className="px-3 py-1.5 flex items-center justify-between border-b border-gray-50 mb-1">
                    <p className="text-xs font-bold uppercase text-gray-400 tracking-wide">
                      Follow-up taken ({followUps.length})
                    </p>
                  </div>
                  {notifLoading ? (
                    <div className="flex justify-center py-6">
                      <div className="w-5 h-5 border-2 border-brand-amber border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : followUps.length === 0 ? (
                    <p className="px-3 py-6 text-sm text-gray-400 text-center">Geen openstaande follow-ups</p>
                  ) : (
                    <div>
                      {followUps.map((task) => {
                        const isOverdue = new Date(task.due_date) < new Date();
                        return (
                          <div
                            key={task.id}
                            className="px-3 py-2.5 hover:bg-gray-50 border-b border-gray-50 last:border-0 flex items-start gap-2"
                          >
                            <button
                              onClick={() => completeFollowUp(task.id)}
                              className="mt-0.5 p-0.5 rounded text-gray-300 hover:text-green-500 transition-colors flex-shrink-0"
                              title="Afronden"
                            >
                              <CheckCircle className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => {
                                if (task.lead_id) router.push(`/leads/${task.lead_id}`);
                                setNotifOpen(false);
                              }}
                              className="flex-1 text-left min-w-0"
                            >
                              <p className="text-sm font-medium truncate">{task.description}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-xs text-gray-400">{task.leads?.company_name}</span>
                                <span className={cn(
                                  "text-[10px] font-semibold px-1.5 py-0.5 rounded-pill",
                                  task.task_type === "follow_up_offerte" ? "bg-blue-50 text-blue-600" :
                                  task.task_type === "offerte_verlopen" ? "bg-red-50 text-red-600" :
                                  "bg-gray-100 text-gray-500"
                                )}>
                                  {task.task_type === "follow_up_offerte" ? "Follow-up" :
                                   task.task_type === "offerte_verlopen" ? "Verlopen" :
                                   task.task_type === "check_in" ? "Check-in" : "Taak"}
                                </span>
                                {task.due_date && (
                                  <span className={cn(
                                    "text-[10px] font-semibold px-1.5 py-0.5 rounded-pill flex items-center gap-1",
                                    isOverdue ? "bg-red-100 text-red-600" : "bg-blue-50 text-blue-600"
                                  )}>
                                    <Calendar className="w-2.5 h-2.5" />
                                    {formatDateTime(task.due_date)}
                                  </span>
                                )}
                              </div>
                            </button>
                            {isOverdue && <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Todo button */}
            <div ref={todoRef} className="relative">
              <button
                onClick={toggleTodos}
                className={cn(
                  "relative p-2 rounded-xl transition-colors",
                  todosOpen
                    ? "bg-brand-amber/10 text-brand-orange"
                    : "text-gray-400 hover:text-brand-dark-gray hover:bg-gray-100"
                )}
                title="Open to-do's"
              >
                <ListTodo className="w-4 h-4" />
                {todos.length > 0 && (
                  <span className={cn(
                    "absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center text-white",
                    hasOverdue ? "bg-red-500" : "bg-brand-orange"
                  )}>
                    {todos.length}
                  </span>
                )}
              </button>

              {/* Todo dropdown */}
              {todosOpen && (
                <div className="absolute right-0 top-full mt-2 w-96 bg-white rounded-2xl shadow-lg border border-gray-100 py-2 max-h-[28rem] overflow-y-auto">
                  <div className="px-3 py-1.5 flex items-center justify-between border-b border-gray-50 mb-1">
                    <p className="text-xs font-bold uppercase text-gray-400 tracking-wide">
                      Open to-do&apos;s ({todos.length})
                    </p>
                  </div>
                  {todoLoading ? (
                    <div className="flex justify-center py-6">
                      <div className="w-5 h-5 border-2 border-brand-amber border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : todos.length === 0 ? (
                    <p className="px-3 py-6 text-sm text-gray-400 text-center">Geen open to-do&apos;s</p>
                  ) : (
                    <div>
                      {todos.map((todo) => {
                        const isOverdue = todo.due_date && new Date(todo.due_date) < new Date();
                        return (
                          <button
                            key={todo.id}
                            onClick={() => {
                              router.push(`/leads/${todo.lead_id}`);
                              setTodosOpen(false);
                            }}
                            className="w-full text-left px-3 py-2.5 hover:bg-gray-50 border-b border-gray-50 last:border-0"
                          >
                            <div className="flex items-start gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{todo.content}</p>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-xs text-gray-400">{todo.leads?.company_name}</span>
                                  {todo.due_date && (
                                    <span className={cn(
                                      "text-[10px] font-semibold px-1.5 py-0.5 rounded-pill flex items-center gap-1",
                                      isOverdue ? "bg-red-100 text-red-600" : "bg-blue-50 text-blue-600"
                                    )}>
                                      <Calendar className="w-2.5 h-2.5" />
                                      {formatDateTime(todo.due_date)}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {isOverdue && <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            <UserSelector />
            <button
              onClick={handleLogout}
              className="p-2 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
              title="Uitloggen"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
