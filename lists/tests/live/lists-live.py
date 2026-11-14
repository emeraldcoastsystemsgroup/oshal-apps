#!/usr/bin/env python3
"""Lists and the grocery chain on a running kernel, as the operator test persona. Loopback only.

CHANGE LOG
1 | maintainer@emeraldcoastsystemsgroup.com | Lists 1.0.0 live proof. Part 1 (always): every Lists route on the kernel's own SQL interpreter, on a list made for the run and deleted at the end. Part 2 (--jarvis): the same through Jarvis, graded by where each step was sent and which tools ran. Part 3 (--grocery): "add eggs, bread and bananas to my grocery list", approve the card, "order the groceries", approve the card; graded by the trace; the three items are removed from the persona's Shopping list afterwards. Shopping's order contacts no store.

It signs in with POST /api/auth/switch {"persona": "operator"} (the installation's test account, never a real
person) using the admin token in the kernel's env file, and signs out at the end. No token, header or cookie is
printed. It refuses any base that is not 127.0.0.1.

    python3 -I lists/tests/live/lists-live.py --base http://127.0.0.1:38798 --env ~/.local/state/oshal-native-green/oshald.env
    python3 -I lists/tests/live/lists-live.py --base ... --env ... --jarvis --grocery
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

GROCERIES = ("eggs", "bread", "bananas")


class Kernel:
    """One signed-in session on a loopback kernel."""

    def __init__(self, base, env_file):
        if not base.startswith("http://127.0.0.1:"):
            sys.exit("refusing a base that is not http://127.0.0.1:<port>")
        self.base = base.rstrip("/")
        token = next((line.split("=", 1)[1].strip().strip('"') for line in Path(env_file).expanduser().read_text().splitlines()
                      if line.startswith("OSHAL_ADMIN_TOKEN=")), None)
        if not token:
            sys.exit("no OSHAL_ADMIN_TOKEN in the env file")
        status, answer = self.call("POST", "/api/auth/switch", {"persona": "operator"}, bearer=token)
        self.session = next((v for k, v in (answer or {}).items() if isinstance(v, str) and ("token" in k.lower() or k.lower() == "session")), None) if isinstance(answer, dict) else None
        if not self.session:
            sys.exit(f"persona switch refused: HTTP {status}")

    def call(self, method, path, body=None, bearer=None, extra=None, timeout=300):
        headers = {"content-type": "application/json", "accept": "application/json", **(extra or {})}
        if bearer:
            headers["authorization"] = "Bearer " + bearer
        elif getattr(self, "session", None):
            headers["x-oshal-session"] = self.session
        request = urllib.request.Request(self.base + path, method=method, headers=headers, data=None if body is None else json.dumps(body).encode())
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
                return response.status, (json.loads(raw) if raw[:1] in (b"{", b"[") else None)
        except urllib.error.HTTPError as err:
            raw = err.read()
            try:
                return err.code, json.loads(raw)
            except ValueError:
                return err.code, None
        except Exception as err:  # the message only, never the request
            return 0, {"error": type(err).__name__}

    def ask(self, message, thread):
        """One Jarvis turn; a turn that answers late is polled until it settles."""
        status, answer = self.call("POST", "/api/jarvis/ask", {"message": message, "sessionId": thread})
        job, waited = isinstance(answer, dict) and answer.get("jobId"), 0
        while status == 202 and job and waited < 600:
            time.sleep(6)
            waited += 6
            status, answer = self.call("GET", "/api/jarvis/ask/result?jobId=" + str(job))
            if status != 200 or not isinstance(answer, dict):
                break
            status = 202 if answer.get("status") in ("pending", "running") or answer.get("pending") is True else 200
        answer = answer if isinstance(answer, dict) else {}
        if isinstance(answer.get("answer"), dict):
            answer = {**answer, **answer["answer"]}
        cards = answer.get("packageToolProposals") or ([answer["packageToolProposal"]] if answer.get("packageToolProposal") else [])
        return {"routed": [(r.get("app"), r.get("outcome")) for r in answer.get("routed") or []],
                "tools": [(s.get("app"), s.get("tool")) for s in answer.get("steps") or [] if s.get("kind") == "tool"],
                "cards": [(c.get("app"), c.get("toolName"), c.get("id")) for c in cards if isinstance(c, dict)]}

    def approve(self, proposal):
        return self.call("POST", "/api/jarvis/package-tools/execute", {"proposalId": proposal}, extra={"x-oshal-package-tool": "1"})

    def close(self):
        self.call("POST", "/signout", {})


class Report:
    """Named checks; the run fails when any is false."""

    def __init__(self):
        self.failed = 0

    def check(self, name, ok, detail=""):
        self.failed += 0 if ok else 1
        print(("ok      " if ok else "FAILED  ") + name + (f"  [{detail}]" if detail and not ok else ""))


def routes(k, report):
    """Every Lists route on the kernel's own interpreter, on a list of this run."""
    name = "Lists live " + uuid.uuid4().hex[:8]
    post = lambda path, body: k.call("POST", "/api/lists" + path, body)
    status, made = post("/lists", {"name": name})
    report.check("make a list", status == 201, f"HTTP {status}")
    status, added = post("/items/add", {"list": name, "items": [{"title": "Alpha", "quantity": 2}, {"title": "Beta", "due": "2026-12-01"}, {"title": "Gamma"}]})
    report.check("add three items", status == 200 and len((added or {}).get("added") or []) == 3, f"HTTP {status}")
    status, again = post("/items/add", {"list": name, "title": "alpha"})
    report.check("an item already there is not added twice", status == 200 and (again or {}).get("already") == ["Alpha"], f"HTTP {status}")
    status, _ = post("/items/check", {"list": name, "item": "Beta"})
    report.check("tick an item", status == 200, f"HTTP {status}")
    status, moved = post("/items/move", {"list": name, "item": "Gamma", "to": "top"})
    report.check("move an item to the top", status == 200 and (moved or {}).get("order") == ["Gamma", "Alpha"], f"HTTP {status}")
    status, _ = post("/items/edit", {"list": name, "item": "Alpha", "note": "live proof", "clear": ["quantity"]})
    report.check("edit an item", status == 200, f"HTTP {status}")
    status, shown = k.call("GET", "/api/lists/show?list=" + urllib.request.quote(name))
    items = (shown or {}).get("items") or []
    report.check("show the list in order", status == 200 and [(i["title"], i["done"]) for i in items] == [("Gamma", False), ("Alpha", False), ("Beta", True)], f"HTTP {status}")
    report.check("the edit is kept", any(i["title"] == "Alpha" and i["note"] == "live proof" and i["quantity"] is None for i in items))
    status, cleared = post("/clear-done", {"list": name})
    report.check("clear the done items", status == 200 and (cleared or {}).get("cleared") == 1, f"HTTP {status}")
    status, _ = post("/items/remove", {"list": name, "item": "Gamma"})
    report.check("remove an item", status == 200, f"HTTP {status}")
    status, grocery = post("/lists", {"name": "Groceries"})
    report.check("a grocery name is Shopping's", status == 409 and (grocery or {}).get("error") == "kept_by_shopping", f"HTTP {status}")
    status, gone = post("/delete", {"list": name})
    report.check("delete the list", status == 200 and (gone or {}).get("removed", {}).get("items") == 1, f"HTTP {status}")
    status, lists = k.call("GET", "/api/lists/lists")
    report.check("the list is gone", status == 200 and name not in [l["name"] for l in (lists or {}).get("lists") or []], f"HTTP {status}")


def jarvis(k, report):
    """A list made, read and deleted by talking to Jarvis."""
    name, thread = "trip " + uuid.uuid4().hex[:6], "lists-live-" + uuid.uuid4().hex[:10]
    turn = k.ask(f"Add socks and a phone charger to my {name} list.", thread)
    report.check("Jarvis sends an add to Lists", ("lists", "answered") in turn["routed"], str(turn["routed"]))
    report.check("the add ran at once, without a card", ("lists", "lists-add-items") in turn["tools"] and not turn["cards"], str(turn["tools"]))
    turn = k.ask(f"What is on my {name} list?", thread)
    report.check("Jarvis reads the list from Lists", ("lists", "lists-show") in turn["tools"], str(turn["tools"]))
    turn = k.ask(f"Delete my {name} list.", thread)
    card = next((c for c in turn["cards"] if c[1] == "lists-delete"), None)
    report.check("deleting a list is a card", bool(card), str(turn["cards"]))
    if card:
        status, _ = k.approve(card[2])
        report.check("the card deletes the list", status == 200, f"HTTP {status}")
    else:
        k.call("POST", "/api/lists/delete", {"list": name})


def grocery(k, report):
    """Add to the grocery list, then order the groceries: one list, one owner, an order made from it."""
    thread = "grocery-live-" + uuid.uuid4().hex[:10]
    turn = k.ask("Add eggs, bread and bananas to my grocery list.", thread)
    report.check("the add goes to Shopping alone", [app for app, _ in turn["routed"]] == ["purchasing"], str(turn["routed"]))
    card = next((c for c in turn["cards"] if c[1] in ("shopping-list-add-many", "shopping-list-add")), None)
    report.check("Shopping holds the add as one card", bool(card) and card[1] == "shopping-list-add-many", str(turn["cards"]))
    if card:
        status, _ = k.approve(card[2])
        report.check("the card puts the items on the list", status == 200, f"HTTP {status}")
    status, cart = k.call("GET", "/api/purchasing/cart")
    titles = [str(i.get("title", "")).lower() for i in (cart or {}).get("items") or []]
    report.check("the three items are on Shopping's list", all(g in titles for g in GROCERIES), f"HTTP {status}")
    status, home = k.call("GET", "/api/home/fridge-assessment")
    kept = (home or {}).get("cart") is not None or bool(((home or {}).get("groceryList") or {}).get("earlier"))
    report.check("Smart Home keeps no grocery list", status != 200 or not kept, f"HTTP {status}")
    turn = k.ask("Order the groceries.", thread)
    report.check("the order goes to Shopping alone", [app for app, _ in turn["routed"]] == ["purchasing"], str(turn["routed"]))
    card = next((c for c in turn["cards"] if c[1] == "shopping-order"), None)
    report.check("Shopping holds the order as a card", bool(card), str(turn["cards"]))
    if card:
        status, made = k.approve(card[2])
        result = (made or {}).get("result") or {}
        ordered = [str(i.get("title", "")).lower() for i in result.get("items") or []]
        report.check("the order is made from the list", status == 200 and all(g in ordered for g in GROCERIES), f"HTTP {status}")
        report.check("every item says where to find it", all(str(i.get("findUrl", "")).startswith("https://www.walmart.com/search?q=") for i in result.get("items") or [{}]))
    list_id = (cart or {}).get("listId")
    for item in (cart or {}).get("items") or []:
        if list_id and str(item.get("title", "")).lower() in GROCERIES and not item.get("product_id"):
            k.call("DELETE", f"/api/purchasing/lists/{list_id}/items/{item['item_id']}")


def main():
    parser = argparse.ArgumentParser(description="Lists and the grocery chain on a running kernel (loopback, operator test persona).")
    parser.add_argument("--base", required=True, help="kernel origin, http://127.0.0.1:<port>")
    parser.add_argument("--env", required=True, help="that installation's oshald.env")
    parser.add_argument("--jarvis", action="store_true", help="also make, read and delete a list through Jarvis")
    parser.add_argument("--grocery", action="store_true", help="also run the grocery chain through Jarvis")
    args = parser.parse_args()
    k, report = Kernel(args.base, args.env), Report()
    try:
        routes(k, report)
        if args.jarvis:
            jarvis(k, report)
        if args.grocery:
            grocery(k, report)
    finally:
        k.close()
    print(f"{'FAILED' if report.failed else 'PASSED'}: {report.failed} check(s) failed")
    sys.exit(1 if report.failed else 0)


if __name__ == "__main__":
    main()
