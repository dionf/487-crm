"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown, User } from "lucide-react";
import { TEAM_MEMBERS } from "@/lib/constants";
import { getInitials } from "@/lib/utils";

export default function UserSelector() {
  const [open, setOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState("Dion");
  const ref = useRef(null);

  useEffect(() => {
    const stored = localStorage.getItem("crm-user");
    if (stored && TEAM_MEMBERS.includes(stored)) {
      setCurrentUser(stored);
    }
  }, []);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function select(name) {
    setCurrentUser(name);
    localStorage.setItem("crm-user", name);
    setOpen(false);
    window.dispatchEvent(new CustomEvent("user-changed", { detail: name }));
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-gray-200 hover:border-brand-amber transition-colors"
      >
        <div className="w-6 h-6 rounded-full bg-brand-amber/20 flex items-center justify-center">
          <span className="text-xs font-semibold text-brand-orange">
            {getInitials(currentUser)}
          </span>
        </div>
        <span className="text-sm font-medium">{currentUser}</span>
        <ChevronDown className="w-3 h-3 text-gray-400" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-40 bg-white rounded-2xl shadow-lg border border-gray-100 py-1 z-50">
          {TEAM_MEMBERS.map((name) => (
            <button
              key={name}
              onClick={() => select(name)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 ${
                name === currentUser ? "text-brand-orange font-medium" : "text-brand-dark-gray"
              }`}
            >
              <div className="w-6 h-6 rounded-full bg-brand-amber/20 flex items-center justify-center">
                <span className="text-xs font-semibold text-brand-orange">
                  {getInitials(name)}
                </span>
              </div>
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
