// Json — минимальный JSON для снимков миров (snapshot / restore): объект (порядок ключей сохраняется), массив, число, строка,
// bool, null. Числа пишутся кратчайшей записью, которая читается обратно тем же числом, — как JSON.stringify, поэтому снимок
// из ядра совпадает со снимком прежнего model.js до символа.
//
//   Json o = Json::object();  o.set("bpm", Json::num(96));  o.set("on", Json::boolean(true));  std::string s = o.dump();
//   bool ok;  Json j = Json::parse(s, &ok);  if (const Json* v = j.get("bpm")) if (v->type == Json::Num) bpm = v->n;
//
// Поля — открытые, по типу: b (Bool), n (Num), s (Str), a (Arr), o (Obj — пары ключ / значение по порядку).
//
// ЛОВУШКИ:
//   - Не для process: выделяет память. Только снимки, между блоками.
//   - NaN и ±inf пишутся как null (в JSON их нет); при разборе такое поле придёт Null — проверяйте type.
//   - \u — только до U+FFFF, суррогатные пары не склеиваются (в снимках их нет). Глубина вложенности не ограничена.
//   - get ищет ключ перебором — для снимков (десятки ключей) этого хватает.
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
  void push(Json v) { a.push_back(std::move(v)); }      // в конец массива
  void set(const std::string& k, Json v) {              // ключ есть — заменить на месте, нет — в конец
    for (auto& e : o) if (e.first == k) { e.second = std::move(v); return; }
    o.emplace_back(k, std::move(v));
  }
  // значение по ключу или nullptr
  const Json* get(const std::string& k) const { for (auto& e : o) if (e.first == k) return &e.second; return nullptr; }

  std::string dump() const { std::string r; write(r); return r; }   // одной строкой, без пробелов
  // ok == false — разбор не удался (значение — Null); мусор после значения — тоже ошибка
  static Json parse(const std::string& src, bool* ok = nullptr) {
    Reader rd{src.c_str(), src.c_str() + src.size(), true};
    Json j = rd.value();
    rd.ws();
    if (rd.at != rd.end) rd.ok = false;
    if (ok) *ok = rd.ok;
    return rd.ok ? j : Json();
  }

 private:
  struct Reader {                                       // разбор: at — текущий символ, end — конец текста, ok — пока без ошибок
    const char* at; const char* end; bool ok;
    void ws() { while (at < end && (*at == ' ' || *at == '\t' || *at == '\n' || *at == '\r')) at++; }
    bool eat(char c) { ws(); if (at < end && *at == c) { at++; return true; } return false; }
    bool word(const char* w) {                          // слово целиком (true / false / null) — съесть, иначе не двигаться
      const char* q = at;
      while (*w) { if (q >= end || *q != *w) return false; q++; w++; }
      at = q; return true;
    }
    Json fail() { ok = false; return Json(); }
    Json value() {
      ws();
      if (at >= end) return fail();
      char c = *at;
      if (c == '{') {
        at++; Json j = object();
        if (eat('}')) return j;
        for (;;) {
          ws();
          if (at >= end || *at != '"') return fail();
          std::string k = string();
          if (!ok || !eat(':')) return fail();
          Json v = value();
          if (!ok) return fail();
          j.o.emplace_back(std::move(k), std::move(v));  // повтор ключа не схлопываем — как пришло
          if (eat(',')) continue;
          if (eat('}')) return j;
          return fail();
        }
      }
      if (c == '[') {
        at++; Json j = array();
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
      if (word("true")) return boolean(true);
      if (word("false")) return boolean(false);
      if (word("null")) return Json();
      char* stop = nullptr;
      std::string tmp;                                  // strtod ждёт '\0' в конце — копируем символы числа (не длиннее 40)
      for (const char* q = at; q < end && tmp.size() < 40 && (*q == '+' || *q == '-' || *q == '.' || *q == 'e' || *q == 'E' || (*q >= '0' && *q <= '9')); q++) tmp += *q;
      double v = std::strtod(tmp.c_str(), &stop);
      if (stop == tmp.c_str()) return fail();
      at += stop - tmp.c_str();
      return num(v);
    }
    std::string string() {                              // строка в кавычках, at — на открывающей; \uXXXX → UTF-8
      std::string r;
      at++;                                             // "
      while (at < end && *at != '"') {
        if (*at == '\\') {
          at++;
          if (at >= end) { ok = false; return r; }
          switch (*at) {
            case 'n': r += '\n'; break;
            case 't': r += '\t'; break;
            case 'r': r += '\r'; break;
            case 'b': r += '\b'; break;
            case 'f': r += '\f'; break;
            case 'u': {
              if (end - at < 5) { ok = false; return r; }
              unsigned cp = static_cast<unsigned>(std::strtoul(std::string(at + 1, at + 5).c_str(), nullptr, 16));
              at += 4;
              if (cp < 0x80) r += static_cast<char>(cp);
              else if (cp < 0x800) { r += static_cast<char>(0xC0 | (cp >> 6)); r += static_cast<char>(0x80 | (cp & 63)); }
              else { r += static_cast<char>(0xE0 | (cp >> 12)); r += static_cast<char>(0x80 | ((cp >> 6) & 63)); r += static_cast<char>(0x80 | (cp & 63)); }
              break;
            }
            default: r += *at;                          // " \ /
          }
          at++;
        } else r += *at++;
      }
      if (at >= end) { ok = false; return r; }         // нет закрывающей кавычки
      at++;                                             // "
      return r;
    }
  };
  void write(std::string& r) const {
    char buf[40];
    switch (type) {
      case Null: r += "null"; break;
      case Bool: r += b ? "true" : "false"; break;
      case Num:                                         // кратчайшее, что читается обратно тем же числом — как JSON.stringify (0.45, не 0.45000000000000001)
        if (n == 0) { r += '0'; break; }                // и −0 — «0», как в JS
        writeNum(r, n, buf); break;
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
  static void writeNum(std::string& r, double n, char* buf) {
    if (!(n == n) || n - n != 0) { r += "null"; return; }   // NaN, ±inf — в JSON их нет
    int prec = 1;                                       // значащих цифр: подбираем от 1, пока не прочтётся тем же числом
    for (; prec <= 17; prec++) { std::snprintf(buf, 40, "%.*e", prec - 1, n); if (std::strtod(buf, nullptr) == n) break; }
    if (prec > 17) prec = 17;
    std::snprintf(buf, 40, "%.*e", prec - 1, n);
    const char* p = buf;
    std::string digits;                                 // цифры без точки
    bool neg = false;
    if (*p == '-') { neg = true; p++; }
    for (; *p && *p != 'e'; p++) if (*p != '.') digits += *p;
    const int e = std::atoi(p + 1), k = static_cast<int>(digits.size()), m = e + 1;   // число = 0.digits × 10^m, k — цифр
    if (neg) r += '-';
    if (k <= m && m <= 21) { r += digits; r.append(static_cast<size_t>(m - k), '0'); }                     // целое до 10^21 — цифрами: 90
    else if (0 < m && m <= 21) { r += digits.substr(0, static_cast<size_t>(m)); r += '.'; r += digits.substr(static_cast<size_t>(m)); }   // 12.5
    else if (-6 < m && m <= 0) { r += "0."; r.append(static_cast<size_t>(-m), '0'); r += digits; }          // 0.000001
    else {                                                                                                  // 1.5e-7, 1e+21
      r += digits[0];
      if (k > 1) { r += '.'; r += digits.substr(1); }
      r += 'e'; r += (m - 1 < 0 ? '-' : '+'); r += std::to_string(m - 1 < 0 ? 1 - m : m - 1);
    }
  }
  static void quote(std::string& r, const std::string& v) {   // в кавычки, с экранированием; не-ASCII — как есть (UTF-8)
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
