// Минимальный JSON для снимков миров: объект (порядок ключей сохраняется), массив, число, строка, bool, null.
// Числа пишутся кратчайшей записью, которая читается обратно без потерь (как JSON.stringify). Не для process: выделяет память.
#pragma once
#include <cstdio>
#include <cstdlib>
#include <string>
#include <utility>
#include <vector>

namespace sdk {

struct Json {
  enum Type { Null, Bool, Num, Str, Arr, Obj };
  Type type = Null;
  bool b = false;
  double n = 0;
  std::string s;
  std::vector<Json> a;
  std::vector<std::pair<std::string, Json>> o;

  static Json num(double v) { Json j; j.type = Num; j.n = v; return j; }
  static Json boolean(bool v) { Json j; j.type = Bool; j.b = v; return j; }
  static Json str(std::string v) { Json j; j.type = Str; j.s = std::move(v); return j; }
  static Json array() { Json j; j.type = Arr; return j; }
  static Json object() { Json j; j.type = Obj; return j; }
  void push(Json v) { a.push_back(std::move(v)); }
  void set(const std::string& k, Json v) {
    for (auto& e : o) if (e.first == k) { e.second = std::move(v); return; }
    o.emplace_back(k, std::move(v));
  }
  const Json* get(const std::string& k) const { for (auto& e : o) if (e.first == k) return &e.second; return nullptr; }

  std::string dump() const { std::string r; write(r); return r; }
  // ok == false — разбор не удался (значение — Null)
  static Json parse(const std::string& src, bool* ok = nullptr) {
    P p{src.c_str(), src.c_str() + src.size(), true};
    Json j = p.value();
    p.ws();
    if (p.p != p.e) p.ok = false;
    if (ok) *ok = p.ok;
    return p.ok ? j : Json();
  }

 private:
  struct P {
    const char* p; const char* e; bool ok;
    void ws() { while (p < e && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')) p++; }
    bool eat(char c) { ws(); if (p < e && *p == c) { p++; return true; } return false; }
    bool lit(const char* w) { const char* q = p; while (*w) { if (q >= e || *q != *w) return false; q++; w++; } p = q; return true; }
    Json fail() { ok = false; return Json(); }
    Json value() {
      ws();
      if (p >= e) return fail();
      char c = *p;
      if (c == '{') {
        p++; Json j = object();
        if (eat('}')) return j;
        for (;;) {
          ws();
          if (p >= e || *p != '"') return fail();
          std::string k = string();
          if (!ok || !eat(':')) return fail();
          Json v = value();
          if (!ok) return fail();
          j.o.emplace_back(std::move(k), std::move(v));
          if (eat(',')) continue;
          if (eat('}')) return j;
          return fail();
        }
      }
      if (c == '[') {
        p++; Json j = array();
        if (eat(']')) return j;
        for (;;) {
          Json v = value();
          if (!ok) return fail();
          j.a.push_back(std::move(v));
          if (eat(',')) continue;
          if (eat(']')) return j;
          return fail();
        }
      }
      if (c == '"') { std::string v = string(); return ok ? Json::str(std::move(v)) : Json(); }
      if (lit("true")) return boolean(true);
      if (lit("false")) return boolean(false);
      if (lit("null")) return Json();
      char* end = nullptr;
      std::string tmp;                                  // strtod ждёт '\0'
      for (const char* q = p; q < e && tmp.size() < 40 && (*q == '+' || *q == '-' || *q == '.' || *q == 'e' || *q == 'E' || (*q >= '0' && *q <= '9')); q++) tmp += *q;
      double v = std::strtod(tmp.c_str(), &end);
      if (end == tmp.c_str()) return fail();
      p += end - tmp.c_str();
      return num(v);
    }
    std::string string() {
      std::string r;
      p++;                                              // "
      while (p < e && *p != '"') {
        if (*p == '\\') {
          p++;
          if (p >= e) { ok = false; return r; }
          switch (*p) {
            case 'n': r += '\n'; break;
            case 't': r += '\t'; break;
            case 'r': r += '\r'; break;
            case 'b': r += '\b'; break;
            case 'f': r += '\f'; break;
            case 'u': {
              if (e - p < 5) { ok = false; return r; }
              unsigned cp = static_cast<unsigned>(std::strtoul(std::string(p + 1, p + 5).c_str(), nullptr, 16));
              p += 4;
              if (cp < 0x80) r += static_cast<char>(cp);
              else if (cp < 0x800) { r += static_cast<char>(0xC0 | (cp >> 6)); r += static_cast<char>(0x80 | (cp & 63)); }
              else { r += static_cast<char>(0xE0 | (cp >> 12)); r += static_cast<char>(0x80 | ((cp >> 6) & 63)); r += static_cast<char>(0x80 | (cp & 63)); }
              break;
            }
            default: r += *p;                           // " \ /
          }
          p++;
        } else r += *p++;
      }
      if (p >= e) { ok = false; return r; }
      p++;                                              // "
      return r;
    }
  };
  void write(std::string& r) const {
    char buf[40];
    switch (type) {
      case Null: r += "null"; break;
      case Bool: r += b ? "true" : "false"; break;
      case Num:                                         // кратчайшее, что читается обратно тем же числом — как JSON.stringify (0.45, не 0.45000000000000001)
        if (n == 0) { r += '0'; break; }
        num(r, n, buf); break;
      case Str: quote(r, s); break;
      case Arr:
        r += '[';
        for (size_t i = 0; i < a.size(); i++) { if (i) r += ','; a[i].write(r); }
        r += ']'; break;
      case Obj:
        r += '{';
        for (size_t i = 0; i < o.size(); i++) { if (i) r += ','; quote(r, o[i].first); r += ':'; o[i].second.write(r); }
        r += '}'; break;
    }
  }
  // число как Number.prototype.toString (JSON.stringify): кратчайшие цифры, которые читаются обратно тем же числом; десятичная запись
  // при показателе от −6 до 20 (90, 0.000001, 1e21 — как в JS), иначе — d.ddde±x. Раньше %g давал 9e+01 вместо 90.
  static void num(std::string& r, double n, char* buf) {
    if (!(n == n) || n - n != 0) { r += "null"; return; }   // NaN, ±inf — в JSON их нет
    int pr = 1;
    for (; pr <= 17; pr++) { std::snprintf(buf, 40, "%.*e", pr - 1, n); if (std::strtod(buf, nullptr) == n) break; }
    if (pr > 17) pr = 17;
    std::snprintf(buf, 40, "%.*e", pr - 1, n);
    const char* p = buf;
    std::string d;                                      // цифры без точки
    bool neg = false;
    if (*p == '-') { neg = true; p++; }
    for (; *p && *p != 'e'; p++) if (*p != '.') d += *p;
    const int e = std::atoi(p + 1), k = static_cast<int>(d.size()), m = e + 1;   // число = 0.d × 10^m
    if (neg) r += '-';
    if (k <= m && m <= 21) { r += d; r.append(static_cast<size_t>(m - k), '0'); }
    else if (0 < m && m <= 21) { r += d.substr(0, static_cast<size_t>(m)); r += '.'; r += d.substr(static_cast<size_t>(m)); }
    else if (-6 < m && m <= 0) { r += "0."; r.append(static_cast<size_t>(-m), '0'); r += d; }
    else {
      r += d[0];
      if (k > 1) { r += '.'; r += d.substr(1); }
      r += 'e'; r += (m - 1 < 0 ? '-' : '+'); r += std::to_string(m - 1 < 0 ? 1 - m : m - 1);
    }
  }
  static void quote(std::string& r, const std::string& v) {
    r += '"';
    for (unsigned char c : v) {
      if (c == '"' || c == '\\') { r += '\\'; r += static_cast<char>(c); }
      else if (c == '\n') r += "\\n";
      else if (c == '\t') r += "\\t";
      else if (c == '\r') r += "\\r";
      else if (c < 0x20) { char u[8]; std::snprintf(u, sizeof u, "\\u%04x", c); r += u; }
      else r += static_cast<char>(c);
    }
    r += '"';
  }
};

}  // namespace sdk
