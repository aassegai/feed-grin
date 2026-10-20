"""Packaging and command-line checks; no Apple tools are executed by these tests."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]

class SafariPackaging(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='feed-grin-safari-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.kit = self.base / 'Kit With Spaces'
        self.kit.mkdir()
        shutil.copytree(ROOT / 'extension', self.kit / 'extension')
        self.script = self.kit / 'create-xcode-project.command'
        shutil.copy2(ROOT / 'safari/create-xcode-project.command', self.script)
        self.bin = self.base / 'bin'
        self.bin.mkdir()
        (self.bin / 'uname').write_text('#!/bin/sh\nprintf "%s\\n" "${FG_TEST_SYSTEM:-Darwin}"\n')
        (self.bin / 'xcrun').write_text('''#!/usr/bin/python3
import json,os,sys
from pathlib import Path
args=sys.argv[1:]
if args[0]=='--find':
    wanted=os.environ.get('FG_TEST_TOOL','safari-web-extension-packager')
    sys.exit(0 if args[1]==wanted else 1)
Path(os.environ['FG_TEST_LOG']).write_text(json.dumps(args))
output=Path(args[args.index('--project-location')+1])
(output/'Feed Grin.xcodeproj').mkdir(parents=True)
''')
        for file in self.bin.iterdir():
            file.chmod(0o755)
        self.log = self.base / 'command.json'
        self.output = self.base / 'Build With Spaces'
        self.env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ['PATH'], FEED_GRIN_NO_OPEN='1', FG_TEST_LOG=str(self.log))

    def run_script(self, platform='both', **env):
        return subprocess.run(['bash', str(self.script), platform, str(self.output)], env=dict(self.env, **env), text=True, capture_output=True)

    def test_both_platforms_and_quoted_paths(self):
        result=self.run_script()
        self.assertEqual(result.returncode,0,result.stderr)
        args=json.loads(self.log.read_text())
        self.assertEqual(args[0],'safari-web-extension-packager')
        self.assertEqual(Path(args[1]).resolve(),(self.kit/'extension').resolve())
        self.assertEqual(args[args.index('--project-location')+1],str(self.output))
        self.assertIn('--copy-resources',args)
        self.assertNotIn('--macos-only',args)
        self.assertNotIn('--ios-only',args)
        self.assertNotIn('--force',args)

    def test_legacy_converter(self):
        result=self.run_script(FG_TEST_TOOL='safari-web-extension-converter')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(json.loads(self.log.read_text())[0],'safari-web-extension-converter')

    def test_ios_only(self):
        result=self.run_script('ios')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('--ios-only',json.loads(self.log.read_text()))

    def test_macos_only_and_bundle_id(self):
        result=self.run_script('macos',FEED_GRIN_BUNDLE_ID='com.example.feedgrin')
        self.assertEqual(result.returncode,0,result.stderr)
        args=json.loads(self.log.read_text())
        self.assertIn('--macos-only',args)
        self.assertEqual(args[args.index('--bundle-identifier')+1],'com.example.feedgrin')

    def test_existing_output_is_preserved(self):
        self.output.mkdir()
        marker=self.output/'keep.txt'
        marker.write_text('keep')
        self.assertNotEqual(self.run_script().returncode,0)
        self.assertEqual(marker.read_text(),'keep')
        self.assertFalse(self.log.exists())

    def test_unknown_platform_is_rejected(self):
        self.assertNotEqual(self.run_script('other').returncode,0)
        self.assertFalse(self.log.exists())

    def test_linux_reports_requirement(self):
        result=self.run_script(FG_TEST_SYSTEM='Linux')
        self.assertNotEqual(result.returncode,0)
        self.assertIn('Mac with full Xcode',result.stderr)

    def test_missing_native_tool_reports_requirement(self):
        result=self.run_script(FG_TEST_TOOL='none')
        self.assertNotEqual(result.returncode,0)
        self.assertIn('Safari packaging tool not found',result.stderr)

    def test_zip_structure_and_resources(self):
        subprocess.run(['python3',str(ROOT/'tools/package_safari.py')],check=True,capture_output=True)
        manifest=json.loads((ROOT/'extension/manifest.json').read_text())
        version=manifest['version']
        with ZipFile(ROOT/f'dist/feed-grin-safari-{version}.zip') as archive:
            self.assertIsNone(archive.testzip())
            self.assertEqual(json.loads(archive.read('manifest.json')),manifest)
            self.assertEqual(manifest['host_permissions'],manifest['content_scripts'][0]['matches'])
            self.assertNotIn('extension/manifest.json',archive.namelist())
            for file in (ROOT/'extension').rglob('*'):
                if file.is_file():self.assertEqual(archive.read(file.relative_to(ROOT/'extension').as_posix()),file.read_bytes())
        with ZipFile(ROOT/f'dist/feed-grin-safari-kit-{version}.zip') as archive:
            self.assertIn('extension/manifest.json',archive.namelist())
            self.assertIn('create-xcode-project.command',archive.namelist())
            self.assertIn('README.md',archive.namelist())

if __name__=='__main__':
    unittest.main(verbosity=2)
