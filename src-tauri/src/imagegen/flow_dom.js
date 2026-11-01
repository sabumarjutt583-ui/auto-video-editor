// Evaluate inside the selected Flow frame, including controls in open shadow roots.
// This does not cross iframe origins; Session discovers each child frame separately.
(expression => {
  const nativeDocument = globalThis.document;
  function rootsUnder(root) {
    const roots = [root];
    for (let index = 0; index < roots.length; index++) {
      for (const node of roots[index].querySelectorAll('*')) {
        if (node.shadowRoot) roots.push(node.shadowRoot);
      }
    }
    return roots;
  }
  const roots = rootsUnder(nativeDocument);
  const tool = roots.map(root => root.querySelector('#ave-video-studio')).find(Boolean);
  const scope = tool ? rootsUnder(tool) : roots;
  const all = selector => scope.flatMap(root => [...root.querySelectorAll(selector)]);
  const document = new Proxy(nativeDocument, {
    get(target, key) {
      if (key === 'querySelectorAll') return all;
      if (key === 'querySelector') return selector => all(selector)[0] || null;
      if (key === 'getElementById') return id => {
        if (tool && tool.id === id) return tool;
        return all('[id]').find(node => node.id === id) || null;
      };
      if (key === 'body' && tool) return tool;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  return eval(expression);
})
