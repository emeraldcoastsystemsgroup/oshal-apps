"""CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Check local renderer containment and non-destructive native engine mapping."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('create_install', Path(__file__).with_name('install-create-k8s.py'))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallContracts(unittest.TestCase):
    def test_preserves_unrelated_engine_bindings(self):
        original = {'env': [{'name': 'OSHAL_PACKAGE_ENGINES', 'value': '{"intelligent-operations":"10.1.2.3:7419"}'}]}
        result = installer.engine_map(original, {'publishing-studio': '10.2.3.4:7419'})
        self.assertEqual(result, {'intelligent-operations': '10.1.2.3:7419', 'publishing-studio': '10.2.3.4:7419'})
        self.assertNotIn('publishing-studio', original['env'][0]['value'])

    def test_externally_managed_map_refused(self):
        with self.assertRaises(ValueError):
            installer.engine_map({'env': [{'name': 'OSHAL_PACKAGE_ENGINES', 'valueFrom': {'secretKeyRef': {}}}]}, {})
        with self.assertRaises(ValueError):
            installer.engine_map({'env': [{'name': 'OSHAL_PACKAGE_ENGINES', 'value': '[]'}]}, {})

    def test_both_engines_have_no_login_or_cluster_mounts(self):
        for package, engine in installer.ENGINES.items():
            objects = installer.manifests('oshal-install-lab', package, engine['image']+':reviewed-'+'a'*16, {'buildHash': 'b'*64})
            pod = objects[0]['spec']['template']['spec']; container = pod['containers'][0]
            self.assertFalse(pod['automountServiceAccountToken'])
            self.assertEqual(pod['volumes'], [{'name': 'temporary', 'emptyDir': {'medium': 'Memory', 'sizeLimit': '512Mi'}}])
            self.assertTrue(container['securityContext']['readOnlyRootFilesystem'])
            self.assertEqual(container['resources']['limits'], {'cpu': '2', 'memory': '1536Mi'})
            self.assertEqual(container['imagePullPolicy'], 'Never')
            self.assertNotIn('envFrom', container)
            self.assertNotIn('hostNetwork', pod)
            self.assertEqual(objects[1]['spec']['ports'], [{'port': engine['port'], 'targetPort': engine['port']}])
            self.assertEqual(objects[2]['spec']['egress'], [])

    def test_unknown_targets_and_mutable_image_names_refused(self):
        for namespace, package, image in [('production', 'publishing-studio', 'x'),
                ('oshal-install-lab', 'unknown', 'x'), ('oshal-install-lab', 'pdf-workbench', 'oshal-pdf-workbench-engine:local')]:
            with self.assertRaises(ValueError):
                installer.manifests(namespace, package, image, {'buildHash': 'b'*64})

    def test_actual_initializer_repairs_sgid_inheritance_and_refuses_a_link(self):
        item = installer.video_scratch_init('reviewed-kernel')
        self.assertEqual(item['volumeMounts'], [{'name': 'scratch', 'mountPath': '/scratch'}])
        with tempfile.TemporaryDirectory() as folder:
            parent = Path(folder); parent.chmod(0o2700); root = parent/'video-scratch'
            root.mkdir(mode=0o700)
            self.assertEqual(root.stat().st_mode & 0o7777, 0o2700)
            # Named host seam: only the private fixture path and executing uid differ.
            script = item['command'][2].replace('/scratch/oshal-video-scratch-10001', str(root)).replace('s.uid!==10001', 's.uid!=='+str(os.getuid()))
            done = subprocess.run(['node', '-e', script], capture_output=True)
            self.assertEqual(done.returncode, 0, done.stderr.decode())
            self.assertEqual(root.stat().st_mode & 0o7777, 0o700)
            root.rmdir(); target = parent/'unrelated'; target.mkdir(mode=0o750); root.symlink_to(target)
            before = target.stat().st_mode
            refused = subprocess.run(['node', '-e', script], capture_output=True)
            self.assertNotEqual(refused.returncode, 0)
            self.assertEqual(target.stat().st_mode, before)


if __name__ == '__main__':
    unittest.main()
